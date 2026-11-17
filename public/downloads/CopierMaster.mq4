//+------------------------------------------------------------------+
//| CopierMaster.mq4  (MT4 version)                                   |
//| Watches this account and reports every trade change to the        |
//| Rails server: open, add, partial close, close, SL/TP modify,       |
//| pending place / modify / delete.                                   |
//|                                                                    |
//| Method: state diff. Every scan compares live positions/orders to  |
//| the last known state, so nothing is missed. Events are queued and |
//| retried (see Common).                                              |
//|                                                                    |
//| MT4 specifics handled here:                                        |
//|  - a partial close gives the remainder a NEW ticket ("from #old"); |
//|    the EA keeps reporting it under the ORIGINAL master ticket so   |
//|    the server/slaves see one continuous position.                  |
//|  - a filled pending order keeps its ticket (becomes a position).   |
//+------------------------------------------------------------------+
#property copyright "THM Technologies Africa"
#property version   "1.00"
#property strict
#property description "Trade copier - MASTER (MT4). Allow WebRequest to your server URL."

#include "CopierCommon4.mqh"

//--- Server
input string InpServerUrl      = "https://your-app.example.com";
input string InpToken          = "";
input int    InpHeartbeatSec   = 5;

//--- What to report
input int    InpScanMs         = 100;     // safety-net scan interval
input int    InpOnlyMagic      = -1;      // -1 = all trades, else only this magic
input string InpSymbols        = "";      // comma list, empty = all symbols
input bool   InpCopyPending    = true;
input bool   InpSkipCopierTrades = true;  // ignore trades tagged "CP:" (avoids loops)
input bool   InpAnnounceExisting = false; // on start, report already-open positions

//--- Dashboard orders
input bool   InpAcceptCommands = true;    // let the dashboard open / close trades on this account
input int    InpOrderMagic     = 770001;  // magic of trades placed from the dashboard
input int    InpSlippagePts    = 30;
input double InpMaxOrderLot    = 10.0;    // safety cap per dashboard order
input int    InpMaxCmdAgeSec   = 15;      // ignore stale open commands
input string InpPrefix         = "";      // broker symbol prefix/suffix, e.g. suffix ".m"
input string InpSuffix         = "";
input string InpQuoteSymbols   = "EURUSD,GBPUSD,USDJPY,XAUUSD,US30";  // prices shown on the dashboard
input bool   InpDebug          = false;

// ticket = the MASTER ticket reported to the server (stays the same across partial closes)
// real   = the live MT4 ticket right now
struct PosState { int ticket; int real; string symbol; int type; double volume; double sl; double tp; double price; };
struct OrdState { int ticket; string symbol; int type; double volume; double price; double sl; double tp; };

PosState g_pos[];
OrdState g_ord[];
string   g_symFilter[];
string   g_gvSeq;
ulong    g_lastHb = 0;
ulong    g_lastPoll = 0;
bool     g_scanning = false;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpToken) == 0 || StringLen(InpServerUrl) == 0)
   {
      Alert("Copier master: set InpServerUrl and InpToken.");
      return INIT_PARAMETERS_INCORRECT;
   }
   CP_Init(InpServerUrl, InpToken, 3000, InpDebug);
   g_gvSeq = "CPM_SEQ_" + (string)AccountNumber();

   if(StringLen(InpSymbols) > 0)
   {
      StringSplit(InpSymbols, ',', g_symFilter);
      for(int i = 0; i < ArraySize(g_symFilter); i++)
      {
         StringTrimLeft(g_symFilter[i]);
         StringTrimRight(g_symFilter[i]);
      }
   }

   // Baseline: what is already open is NOT treated as a new trade,
   // unless the user asks for it (server dedupes by master ticket).
   if(!InpAnnounceExisting) BuildPos(g_pos);
   BuildOrd(g_ord);

   EventSetMillisecondTimer(MathMax(50, InpScanMs));
   CP_Log("Master started on account " + (string)AccountNumber());
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

// MT4 has no OnTradeTransaction; ticks + the timer below drive the scan.
void OnTick()
{
   Scan();   // only queues; network happens in OnTimer
}

void OnTimer()
{
   Scan();
   CP_FlushOutbox();
   if(InpAcceptCommands && CP_NowMs() - g_lastPoll >= 300)
   {
      PollCommands();
      g_lastPoll = CP_NowMs();
   }
   if(CP_NowMs() - g_lastHb >= (ulong)InpHeartbeatSec * 1000)
   {
      Heartbeat();
      g_lastHb = CP_NowMs();
   }
}

//+------------------------------------------------------------------+
//| Helpers                                                           |
//+------------------------------------------------------------------+
ulong NextSeq()
{
   double v = GlobalVariableCheck(g_gvSeq) ? GlobalVariableGet(g_gvSeq) : 0;
   v += 1;
   GlobalVariableSet(g_gvSeq, v);
   return (ulong)v;
}

bool SymbolAllowed(string s)
{
   if(ArraySize(g_symFilter) == 0) return true;
   for(int i = 0; i < ArraySize(g_symFilter); i++)
      if(g_symFilter[i] == s) return true;
   return false;
}

string OrdSide(int t)
{
   switch(t)
   {
      case OP_BUYLIMIT:  return "buy_limit";
      case OP_SELLLIMIT: return "sell_limit";
      case OP_BUYSTOP:   return "buy_stop";
      case OP_SELLSTOP:  return "sell_stop";
   }
   return "";
}

//--- Partial-close tracking (terminal global variables survive restarts)
string GVRoot(int t) { return "CPR_" + (string)AccountNumber() + "_" + (string)t; }
string GVSkip(int t) { return "CPK_" + (string)AccountNumber() + "_" + (string)t; }

// Maps a live ticket to the original (root) master ticket.
// A partial close leaves a remainder whose comment is "from #<previous ticket>".
int ResolveRoot(int t, string cm)
{
   string gk = GVRoot(t);
   if(GlobalVariableCheck(gk)) return (int)GlobalVariableGet(gk);
   if(StringFind(cm, "from #") == 0)
   {
      int p = (int)StringToInteger(StringSubstr(cm, 6));
      int root = p;
      if(GlobalVariableCheck(GVRoot(p))) root = (int)GlobalVariableGet(GVRoot(p));
      GlobalVariableSet(gk, (double)root);
      if(GlobalVariableCheck(GVSkip(p))) GlobalVariableSet(GVSkip(t), 1);   // keep "copier trade" flag
      return root;
   }
   return t;
}

// True for trades placed by a slave EA on this account (comment "CP:"); the flag
// survives partial closes because the remainder's comment is overwritten by MT4.
bool IsCopierTrade(int t, string cm)
{
   if(StringFind(cm, "CP:") == 0)
   {
      if(!GlobalVariableCheck(GVSkip(t))) GlobalVariableSet(GVSkip(t), 1);
      return true;
   }
   return GlobalVariableCheck(GVSkip(t));
}

void BuildPos(PosState &out[])
{
   ArrayResize(out, 0);
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int ty = OrderType();
      if(ty != OP_BUY && ty != OP_SELL) continue;

      int    t   = OrderTicket();
      string sym = OrderSymbol();
      string cm  = OrderComment();
      int    root = ResolveRoot(t, cm);
      bool   cp   = IsCopierTrade(t, cm);

      if(!SymbolAllowed(sym)) continue;
      if(InpOnlyMagic >= 0 && OrderMagicNumber() != InpOnlyMagic) continue;
      if(InpSkipCopierTrades && cp) continue;

      int n = ArraySize(out);
      ArrayResize(out, n + 1);
      out[n].ticket = root;
      out[n].real   = t;
      out[n].symbol = sym;
      out[n].type   = ty;
      out[n].volume = OrderLots();
      out[n].sl     = OrderStopLoss();
      out[n].tp     = OrderTakeProfit();
      out[n].price  = OrderOpenPrice();
   }
}

void BuildOrd(OrdState &out[])
{
   ArrayResize(out, 0);
   if(!InpCopyPending) return;
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int ty = OrderType();
      if(ty <= OP_SELL) continue;
      if(OrdSide(ty) == "") continue;

      int    t   = OrderTicket();
      string sym = OrderSymbol();
      bool   cp  = IsCopierTrade(t, OrderComment());

      if(!SymbolAllowed(sym)) continue;
      if(InpOnlyMagic >= 0 && OrderMagicNumber() != InpOnlyMagic) continue;
      if(InpSkipCopierTrades && cp) continue;

      int n = ArraySize(out);
      ArrayResize(out, n + 1);
      out[n].ticket = t;
      out[n].symbol = sym;
      out[n].type   = ty;
      out[n].volume = OrderLots();
      out[n].price  = OrderOpenPrice();
      out[n].sl     = OrderStopLoss();
      out[n].tp     = OrderTakeProfit();
   }
}

int FindPos(PosState &a[], int t)
{
   for(int i = 0; i < ArraySize(a); i++) if(a[i].ticket == t) return i;
   return -1;
}
int FindOrd(OrdState &a[], int t)
{
   for(int i = 0; i < ArraySize(a); i++) if(a[i].ticket == t) return i;
   return -1;
}

// In MT4 a filled pending order keeps its ticket and becomes OP_BUY / OP_SELL.
// Filled ones are NOT reported as deleted: the position scan produces an "open".
bool OrderWasFilled(int t)
{
   if(!OrderSelect(t, SELECT_BY_TICKET)) return false;
   return (OrderType() == OP_BUY || OrderType() == OP_SELL);
}

//+------------------------------------------------------------------+
//| Event emission                                                    |
//+------------------------------------------------------------------+
void Emit(string type, int ticket, string sym, string side,
          double vol, double prevVol, double price, double sl, double tp,
          double profit = 0, bool hasProfit = false)
{
   string key = (string)AccountNumber() + "-" + (string)NextSeq();
   string j = "{";
   j += "\"idempotency_key\":\"" + key + "\",";
   j += "\"event_type\":\"" + type + "\",";
   j += "\"master_ticket\":" + (string)ticket + ",";
   j += "\"symbol\":\"" + CP_Esc(sym) + "\",";
   j += "\"side\":\"" + side + "\",";
   j += "\"volume\":" + DoubleToString(vol, 8) + ",";
   j += "\"prev_volume\":" + DoubleToString(prevVol, 8) + ",";
   j += "\"price\":" + DoubleToString(price, 8) + ",";
   j += "\"sl\":" + DoubleToString(sl, 8) + ",";
   j += "\"tp\":" + DoubleToString(tp, 8) + ",";
   if(hasProfit) j += "\"profit\":" + DoubleToString(profit, 2) + ",";
   j += "\"master_balance\":" + DoubleToString(AccountBalance(), 2) + ",";
   j += "\"master_equity\":" + DoubleToString(AccountEquity(), 2) + ",";
   j += "\"event_time\":" + (string)(long)TimeGMT() + ",";
   j += "\"platform\":\"mt4\"}";
   CP_Enqueue("/api/v1/events", j);
   CP_Dbg("event " + type + " #" + (string)ticket + " " + sym);
}

void EmitPos(string type, PosState &p, double vol, double prevVol)
{
   string side = (p.type == OP_BUY) ? "buy" : "sell";
   Emit(type, p.ticket, p.symbol, side, vol, prevVol, p.price, p.sl, p.tp);
}

// Net result (profit + swap + commission) of a closed position. In MT4 the position may have
// been partially closed before, so walk back through the "from #<ticket>" chain and add every piece.
bool ClosedProfit(int realTicket, double &profit)
{
   double sum = 0;
   bool closed = false;
   int t = realTicket;
   for(int guard = 0; guard < 50 && t > 0; guard++)
   {
      if(!OrderSelect(t, SELECT_BY_TICKET)) break;
      if(guard == 0 && OrderCloseTime() == 0) return false;   // still open
      if(OrderCloseTime() > 0) closed = true;
      sum += OrderProfit() + OrderSwap() + OrderCommission();
      string cm = OrderComment();
      if(StringFind(cm, "from #") != 0) break;
      t = (int)StringToInteger(StringSubstr(cm, 6));
   }
   profit = sum;
   return closed;
}

void EmitClose(PosState &p)
{
   double pr = 0;
   bool has = ClosedProfit(p.real, pr);
   string side = (p.type == OP_BUY) ? "buy" : "sell";
   Emit("close", p.ticket, p.symbol, side, p.volume, p.volume, p.price, p.sl, p.tp, pr, has);
}

void EmitOrd(string type, OrdState &o)
{
   Emit(type, o.ticket, o.symbol, OrdSide(o.type), o.volume, 0, o.price, o.sl, o.tp);
}

//+------------------------------------------------------------------+
//| Scanning (state diff)                                             |
//+------------------------------------------------------------------+
void Scan()
{
   if(g_scanning) return;
   g_scanning = true;
   ScanPositions();
   ScanOrders();
   g_scanning = false;
}

void ScanPositions()
{
   PosState cur[];
   BuildPos(cur);
   const double eps = 1e-8;

   for(int i = 0; i < ArraySize(cur); i++)
   {
      int j = FindPos(g_pos, cur[i].ticket);
      if(j < 0) { EmitPos("open", cur[i], cur[i].volume, 0); continue; }

      double dv = cur[i].volume - g_pos[j].volume;
      if(dv < -eps)      EmitPos("partial_close", cur[i], -dv, g_pos[j].volume);
      else if(dv > eps)  EmitPos("add",           cur[i],  dv, g_pos[j].volume);

      if(MathAbs(cur[i].sl - g_pos[j].sl) > eps || MathAbs(cur[i].tp - g_pos[j].tp) > eps)
         EmitPos("modify", cur[i], cur[i].volume, 0);
   }

   for(int j = 0; j < ArraySize(g_pos); j++)
      if(FindPos(cur, g_pos[j].ticket) < 0)
         EmitClose(g_pos[j]);

   ArrayResize(g_pos, ArraySize(cur));
   for(int i = 0; i < ArraySize(cur); i++) g_pos[i] = cur[i];
}

void ScanOrders()
{
   if(!InpCopyPending) return;
   OrdState cur[];
   BuildOrd(cur);
   const double eps = 1e-8;

   for(int i = 0; i < ArraySize(cur); i++)
   {
      int j = FindOrd(g_ord, cur[i].ticket);
      if(j < 0) { EmitOrd("pending_place", cur[i]); continue; }
      if(MathAbs(cur[i].price - g_ord[j].price) > eps ||
         MathAbs(cur[i].sl - g_ord[j].sl) > eps ||
         MathAbs(cur[i].tp - g_ord[j].tp) > eps)
         EmitOrd("pending_modify", cur[i]);
   }

   for(int j = 0; j < ArraySize(g_ord); j++)
      if(FindOrd(cur, g_ord[j].ticket) < 0 && !OrderWasFilled(g_ord[j].ticket))
         EmitOrd("pending_delete", g_ord[j]);

   ArrayResize(g_ord, ArraySize(cur));
   for(int i = 0; i < ArraySize(cur); i++) g_ord[i] = cur[i];
}

//+------------------------------------------------------------------+
//| Heartbeat: liveness + full list of open tickets for reconciliation|
//+------------------------------------------------------------------+
void Heartbeat()
{
   string tickets = "";
   for(int i = 0; i < ArraySize(g_pos); i++)
      tickets += (i > 0 ? "," : "") + (string)g_pos[i].ticket;
   string pend = "";
   for(int i = 0; i < ArraySize(g_ord); i++)
      pend += (i > 0 ? "," : "") + (string)g_ord[i].ticket;

   string j = "{";
   j += "\"role\":\"master\",\"platform\":\"mt4\",";
   j += "\"login\":" + (string)AccountNumber() + ",";
   j += "\"server\":\"" + CP_Esc(AccountServer()) + "\",";
   j += "\"balance\":" + DoubleToString(AccountBalance(), 2) + ",";
   j += "\"equity\":" + DoubleToString(AccountEquity(), 2) + ",";
   j += "\"open_tickets\":[" + tickets + "],";
   j += "\"pending_tickets\":[" + pend + "],";
   j += "\"positions\":" + CP_PositionsJson() + ",";
   j += "\"quotes\":" + QuotesJson() + ",";
   j += "\"outbox\":" + (string)ArraySize(g_out) + ",";
   j += "\"ts\":" + (string)(long)TimeGMT() + "}";

   string resp;
   int code = CP_Http("POST", "/api/v1/heartbeat", j, resp);
   Comment(StringFormat("Copier MASTER (MT4) | server: %s | open: %d | queued: %d",
           code == 200 ? "OK" : "ERR " + (string)code, ArraySize(g_pos), ArraySize(g_out)));
}

//+------------------------------------------------------------------+
//| Prices for the dashboard's order ticket                           |
//+------------------------------------------------------------------+
string QuotesJson()
{
   string bases[];
   int n = StringSplit(InpQuoteSymbols, ',', bases);
   string out = "";
   for(int i = 0; i < n; i++)
   {
      StringTrimLeft(bases[i]); StringTrimRight(bases[i]);
      if(bases[i] == "") continue;
      string item = CP_QuoteItem(bases[i], CP_FindSymbol(bases[i], InpPrefix, InpSuffix));
      if(item == "") continue;
      if(out != "") out += ",";
      out += item;
   }
   return "{" + out + "}";
}

//+------------------------------------------------------------------+
//| Dashboard orders: open / pending / close one / modify / close all |
//| Command line (pipe-separated):                                    |
//| id|action|key|symbol|side|vol|price|sl|tp|lotMode|lotValue|       |
//| masterBalance|reverse|ratio|createdEpoch|slippage|suffix           |
//| For close_ticket, key is the broker ticket.                        |
//+------------------------------------------------------------------+
struct MCmd { long id; string action; int key; string symbol; string side; double volume; double price; double sl; double tp; long created; int slip; };
struct MRes { string status; string msg; int ticket; double volume; double price; };

string GVLast() { return "CPL_" + (string)AccountNumber(); }

bool TradingAllowed()
{
   return TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
          MQLInfoInteger(MQL_TRADE_ALLOWED) &&
          AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
}

void PollCommands()
{
   string resp;
   int code = CP_Http("GET", "/api/v1/commands/pending?limit=10", "", resp);
   if(code != 200) return;

   string lines[];
   int n = CP_Lines(resp, lines);
   for(int i = 0; i < n; i++)
   {
      if(StringLen(lines[i]) < 5) continue;
      string p[];
      int np = StringSplit(lines[i], '|', p);
      if(np < 15) continue;

      MCmd c;
      c.id      = StringToInteger(p[0]);
      c.action  = p[1];
      c.key     = (int)StringToInteger(p[2]);
      c.symbol  = p[3];
      c.side    = p[4];
      c.volume  = StringToDouble(p[5]);
      c.price   = StringToDouble(p[6]);
      c.sl      = StringToDouble(p[7]);
      c.tp      = StringToDouble(p[8]);
      c.created = StringToInteger(p[14]);
      c.slip    = (np > 15) ? (int)StringToInteger(p[15]) : 0;

      MRes r;
      r.status = "failed"; r.msg = ""; r.ticket = 0; r.volume = 0; r.price = 0;

      // Replay the original result for redelivered commands.
      long login = (long)AccountNumber();
      long last = (long)GlobalVariableGet(GVLast());

      if(c.id <= last)
      {
         int saved = CP_ResultFind("master", login, c.id,
                                   r.status, r.msg, r.ticket, r.volume, r.price);
         if(saved == 0)
         {
            r.status = "skipped";
            r.msg = "already processed";
         }
         else if(saved < 0)
         {
            CP_Log("Cannot inspect result ledger for command " + (string)c.id +
                   "; delaying acknowledgement.");
            continue;
         }
      }
      else
      {
         MExecute(c, r);

         // Persist the result before advancing the processed marker.
         bool stored = CP_ResultSave("master", login, c.id,
                                     r.status, r.msg, r.ticket, r.volume, r.price);
         if(!stored)
            CP_Log("WARNING: command " + (string)c.id +
                   " executed but its result could not be persisted.");

         // Never execute this command again in this terminal session.
         GlobalVariableSet(GVLast(), (double)c.id);
      }

      MAck(c, r);
   }
   if(n > 0) CP_FlushOutbox();
}

void MExecute(MCmd &c, MRes &r)
{
   if(c.action == "open")                  MOpen(c, r);
   else if(c.action == "pending_place")    MPending(c, r);
   else if(c.action == "close_ticket")     MCloseTicket(c, r);
   else if(c.action == "modify_ticket")    MModifyTicket(c, r);
   else if(c.action == "close_all")        MCloseAll(r);
   else { r.status = "skipped"; r.msg = "master does not handle " + c.action; }
}

void MAck(MCmd &c, MRes &r)
{
   string j = "{";
   j += "\"status\":\"" + r.status + "\",";
   j += "\"message\":\"" + CP_Esc(r.msg) + "\",";
   j += "\"slave_ticket\":" + (string)r.ticket + ",";
   j += "\"volume\":" + DoubleToString(r.volume, 8) + ",";
   j += "\"price\":" + DoubleToString(r.price, 8) + "}";
   CP_Enqueue("/api/v1/commands/" + (string)c.id + "/ack", j);
}

// Rounds a lot down to the broker step, capped by the broker max and InpMaxOrderLot.
// Returns 0 when below the broker minimum.
double MasterLot(string sym, double want)
{
   double step = MarketInfo(sym, MODE_LOTSTEP);
   double mn   = MarketInfo(sym, MODE_MINLOT);
   double mx   = MathMin(MarketInfo(sym, MODE_MAXLOT), InpMaxOrderLot);
   if(step <= 0) step = 0.01;
   double vol = MathFloor(MathMin(want, mx) / step + 1e-9) * step;
   if(vol < mn) return 0;
   return NormalizeDouble(vol, (int)MathMax(0, MathRound(-MathLog10(step))));
}

void MOpen(MCmd &c, MRes &r)
{
   if(!TradingAllowed())
   { r.status = "skipped"; r.msg = "trading not allowed (enable AutoTrading and EA trading)"; return; }

   if(InpMaxCmdAgeSec > 0 && c.created > 0 && (long)TimeGMT() - c.created > InpMaxCmdAgeSec)
   { r.status = "skipped"; r.msg = "stale command"; return; }

   if(c.side != "buy" && c.side != "sell") { r.msg = "bad side " + c.side; return; }
   string sym = CP_FindSymbol(c.symbol, InpPrefix, InpSuffix);
   if(sym == "") { r.msg = "symbol not found: " + c.symbol; return; }

   bool isBuy = (c.side == "buy");
   double vol = MasterLot(sym, c.volume);
   if(vol <= 0) { r.status = "skipped"; r.msg = "lot below broker minimum"; return; }

   // keep SL/TP at least the broker's minimum distance away
   int    dg = (int)MarketInfo(sym, MODE_DIGITS);
   double md = MarketInfo(sym, MODE_STOPLEVEL) * MarketInfo(sym, MODE_POINT);
   double ref = isBuy ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK);
   double sl = c.sl, tp = c.tp;
   if(sl > 0)
   {
      if(isBuy  && ref - sl < md) sl = ref - md;
      if(!isBuy && sl - ref < md) sl = ref + md;
      sl = NormalizeDouble(sl, dg);
   }
   if(tp > 0)
   {
      if(isBuy  && tp - ref < md) tp = ref + md;
      if(!isBuy && ref - tp < md) tp = ref - md;
      tp = NormalizeDouble(tp, dg);
   }

   int ticket, err; double price;
   bool ok = CP_SendMarket(sym, isBuy, vol, sl, tp, "ML:dash", InpOrderMagic,
                           c.slip > 0 ? c.slip : InpSlippagePts, 2, ticket, price, err);
   if(!ok) { r.msg = CP_Err(err); return; }

   r.status = "executed"; r.ticket = ticket; r.volume = vol; r.price = price;
}

// Place a dashboard-originated pending order on the master account.
// The resulting order is detected by ScanOrders() and copied to followers.
void MPending(MCmd &c, MRes &r)
{
   if(!TradingAllowed())
   { r.status = "skipped"; r.msg = "trading not allowed (enable AutoTrading and EA trading)"; return; }

   if(InpMaxCmdAgeSec > 0 && c.created > 0 && (long)TimeGMT() - c.created > InpMaxCmdAgeSec)
   { r.status = "skipped"; r.msg = "stale command"; return; }

   bool isBuy = (c.side == "buy_limit" || c.side == "buy_stop");
   if(!isBuy && c.side != "sell_limit" && c.side != "sell_stop")
   { r.status = "skipped"; r.msg = "unsupported pending order side: " + c.side; return; }

   if(c.price <= 0)
   { r.status = "skipped"; r.msg = "pending order entry price must be positive"; return; }

   string sym = CP_FindSymbol(c.symbol, InpPrefix, InpSuffix);
   if(sym == "") { r.msg = "symbol not found: " + c.symbol; return; }

   double vol = MasterLot(sym, c.volume);
   if(vol <= 0) { r.status = "skipped"; r.msg = "lot below broker minimum"; return; }

   int dg = (int)MarketInfo(sym, MODE_DIGITS);
   double minDistance = MarketInfo(sym, MODE_STOPLEVEL) * MarketInfo(sym, MODE_POINT);

   double entry = NormalizeDouble(c.price, dg);
   double sl = (c.sl > 0 ? NormalizeDouble(c.sl, dg) : 0.0);
   double tp = (c.tp > 0 ? NormalizeDouble(c.tp, dg) : 0.0);
   double bid = MarketInfo(sym, MODE_BID);
   double ask = MarketInfo(sym, MODE_ASK);

   if(bid <= 0 || ask <= 0) { r.msg = "symbol has no valid bid/ask quote"; return; }

   if(c.side == "buy_limit"  && entry >= ask) { r.status = "skipped"; r.msg = "buy limit entry must be below ask";  return; }
   if(c.side == "buy_stop"   && entry <= ask) { r.status = "skipped"; r.msg = "buy stop entry must be above ask";   return; }
   if(c.side == "sell_limit" && entry <= bid) { r.status = "skipped"; r.msg = "sell limit entry must be above bid"; return; }
   if(c.side == "sell_stop"  && entry >= bid) { r.status = "skipped"; r.msg = "sell stop entry must be below bid";  return; }

   // Keep protective levels on the correct side of the pending entry
   // and outside the broker's minimum stop distance.
   if(sl > 0)
   {
      if(isBuy && entry - sl < minDistance) sl = entry - minDistance;
      if(!isBuy && sl - entry < minDistance) sl = entry + minDistance;
      sl = NormalizeDouble(sl, dg);
   }
   if(tp > 0)
   {
      if(isBuy && tp - entry < minDistance) tp = entry + minDistance;
      if(!isBuy && entry - tp < minDistance) tp = entry - minDistance;
      tp = NormalizeDouble(tp, dg);
   }

   int type = OP_BUYLIMIT;
   if(c.side == "sell_limit") type = OP_SELLLIMIT;
   else if(c.side == "buy_stop") type = OP_BUYSTOP;
   else if(c.side == "sell_stop") type = OP_SELLSTOP;

   int ticket, err;
   if(!CP_SendPending(sym, type, vol, entry, sl, tp, "ML:dash", InpOrderMagic, ticket, err))
   { r.msg = CP_Err(err); return; }

   r.status = "executed";
   r.msg = "pending order placed";
   r.ticket = ticket;
   r.volume = vol;
   r.price = entry;
}

void MCloseTicket(MCmd &c, MRes &r)
{
   if(!CP_IsPos(c.key)) { r.status = "skipped"; r.msg = "no open position with that ticket"; return; }
   double vol = OrderLots();
   int err; double price;
   if(!CP_CloseOrder(c.key, vol, c.slip > 0 ? c.slip : InpSlippagePts, 2, price, err))
   { r.msg = CP_Err(err); return; }
   r.status = "executed"; r.ticket = c.key; r.volume = vol; r.price = price;
}

// Modify SL/TP on one raw broker position ticket (dashboard edit).
void MModifyTicket(MCmd &c, MRes &r)
{
   if(!CP_IsPos(c.key))
   { r.status = "skipped"; r.msg = "no open position with that ticket"; return; }

   string sym = OrderSymbol();
   double oldSL = OrderStopLoss();
   double oldTP = OrderTakeProfit();
   double pt = MarketInfo(sym, MODE_POINT);

   if(MathAbs(c.sl - oldSL) < pt / 2 && MathAbs(c.tp - oldTP) < pt / 2)
   { r.status = "skipped"; r.msg = "no change"; r.ticket = c.key; return; }

   int err;
   if(!CP_ModifyOrder(c.key, 0, c.sl, c.tp, err))
   { r.msg = CP_Err(err); return; }

   r.status = "executed";
   r.ticket = c.key;
}

void MCloseAll(MRes &r)
{
   int closed = 0, deleted = 0, failed = 0;

   // collect first: closing changes the pool while we iterate
   int tk[]; int ty[];
   int total = OrdersTotal();
   ArrayResize(tk, 0); ArrayResize(ty, 0);
   for(int i = total - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int k = ArraySize(tk);
      ArrayResize(tk, k + 1); ArrayResize(ty, k + 1);
      tk[k] = OrderTicket();
      ty[k] = OrderType();
   }

   for(int i = 0; i < ArraySize(tk); i++)
   {
      int err; double price;
      if(ty[i] <= OP_SELL)
      {
         if(!CP_IsPos(tk[i])) continue;
         if(CP_CloseOrder(tk[i], OrderLots(), InpSlippagePts, 2, price, err)) closed++;
         else failed++;
      }
      else
      {
         if(CP_DeleteOrder(tk[i], err)) deleted++;
         else failed++;
      }
   }

   r.status = (failed == 0) ? "executed" : "failed";
   r.msg = StringFormat("closed %d, deleted pending %d, failed %d", closed, deleted, failed);
}
//+------------------------------------------------------------------+
