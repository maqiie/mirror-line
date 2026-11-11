//+------------------------------------------------------------------+
//| CopierMaster.mq5                                                  |
//| Watches this account and reports every trade change to the        |
//| Rails server: open, add, partial close, close, SL/TP modify,       |
//| pending place / modify / delete.                                   |
//|                                                                    |
//| Method: state diff. Every scan compares live positions/orders to  |
//| the last known state, so nothing is missed even if a transaction   |
//| event is dropped. Events are queued and retried (see Common).      |
//+------------------------------------------------------------------+
#property copyright "THM Technologies Africa"
#property version   "1.00"
#property strict
#property description "Trade copier - MASTER. Allow WebRequest to your server URL."

#include <Trade\Trade.mqh>
#include "CopierCommon.mqh"

input group "Server"
input string InpServerUrl      = "https://your-app.example.com";
input string InpToken          = "";
input int    InpHeartbeatSec   = 5;

input group "What to report"
input int    InpScanMs         = 100;     // safety-net scan interval
input long   InpOnlyMagic      = -1;      // -1 = all trades, else only this magic
input string InpSymbols        = "";      // comma list, empty = all symbols
input bool   InpCopyPending    = true;
input bool   InpSkipCopierTrades = true;  // ignore trades tagged "CP:" (avoids loops)
input bool   InpAnnounceExisting = false; // on start, report already-open positions
input group "Dashboard orders"
input bool   InpAcceptCommands = true;    // let the dashboard open / close trades on this account
input long   InpOrderMagic     = 770001;  // magic of trades placed from the dashboard
input int    InpSlippagePts    = 30;
input double InpMaxOrderLot    = 10.0;    // safety cap per dashboard order
input int    InpMaxCmdAgeSec   = 15;      // ignore stale open commands
input string InpPrefix         = "";      // broker symbol prefix/suffix, e.g. suffix ".m"
input string InpSuffix         = "";
input string InpQuoteSymbols   = "EURUSD,GBPUSD,USDJPY,XAUUSD,US30";  // prices shown on the dashboard
input bool   InpDebug          = false;

struct PosState { ulong ticket; string symbol; long type; double volume; double sl; double tp; double price; };
struct OrdState { ulong ticket; string symbol; long type; double volume; double price; double sl; double tp; };

PosState g_pos[];
OrdState g_ord[];
string   g_symFilter[];
string   g_gvSeq;
ulong    g_lastHb = 0;
ulong    g_lastPoll = 0;
bool     g_scanning = false;
CTrade   g_trade;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpToken) == 0 || StringLen(InpServerUrl) == 0)
   {
      Alert("Copier master: set InpServerUrl and InpToken.");
      return INIT_PARAMETERS_INCORRECT;
   }
   CP_Init(InpServerUrl, InpToken, 3000, InpDebug);
   g_gvSeq = "CPM_SEQ_" + (string)AccountInfoInteger(ACCOUNT_LOGIN);

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

   g_trade.SetExpertMagicNumber(InpOrderMagic);
   g_trade.SetDeviationInPoints(InpSlippagePts);
   g_trade.SetAsyncMode(false);

   EventSetMillisecondTimer(MathMax(50, InpScanMs));
   CP_Log("Master started on account " + (string)AccountInfoInteger(ACCOUNT_LOGIN));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   Scan();   // only queues; network happens in OnTimer
}

void OnTimer()
{
   Scan();
   CP_FlushOutbox();
   if(InpAcceptCommands && GetTickCount64() - g_lastPoll >= 300)
   {
      PollCommands();
      g_lastPoll = GetTickCount64();
   }
   if(GetTickCount64() - g_lastHb >= (ulong)InpHeartbeatSec * 1000)
   {
      Heartbeat();
      g_lastHb = GetTickCount64();
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

string OrdSide(long t)
{
   switch((int)t)
   {
      case ORDER_TYPE_BUY_LIMIT:  return "buy_limit";
      case ORDER_TYPE_SELL_LIMIT: return "sell_limit";
      case ORDER_TYPE_BUY_STOP:   return "buy_stop";
      case ORDER_TYPE_SELL_STOP:  return "sell_stop";
   }
   return "";   // stop-limit types are not copied
}

void BuildPos(PosState &out[])
{
   ArrayResize(out, 0);
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      if(!SymbolAllowed(sym)) continue;
      if(InpOnlyMagic >= 0 && PositionGetInteger(POSITION_MAGIC) != InpOnlyMagic) continue;
      if(InpSkipCopierTrades && StringFind(PositionGetString(POSITION_COMMENT), "CP:") == 0) continue;

      int n = ArraySize(out);
      ArrayResize(out, n + 1);
      out[n].ticket = t;
      out[n].symbol = sym;
      out[n].type   = PositionGetInteger(POSITION_TYPE);
      out[n].volume = PositionGetDouble(POSITION_VOLUME);
      out[n].sl     = PositionGetDouble(POSITION_SL);
      out[n].tp     = PositionGetDouble(POSITION_TP);
      out[n].price  = PositionGetDouble(POSITION_PRICE_OPEN);
   }
}

void BuildOrd(OrdState &out[])
{
   ArrayResize(out, 0);
   if(!InpCopyPending) return;
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      ulong t = OrderGetTicket(i);
      if(t == 0) continue;
      string sym = OrderGetString(ORDER_SYMBOL);
      if(!SymbolAllowed(sym)) continue;
      long type = OrderGetInteger(ORDER_TYPE);
      if(OrdSide(type) == "") continue;
      if(InpOnlyMagic >= 0 && OrderGetInteger(ORDER_MAGIC) != InpOnlyMagic) continue;
      if(InpSkipCopierTrades && StringFind(OrderGetString(ORDER_COMMENT), "CP:") == 0) continue;

      int n = ArraySize(out);
      ArrayResize(out, n + 1);
      out[n].ticket = t;
      out[n].symbol = sym;
      out[n].type   = type;
      out[n].volume = OrderGetDouble(ORDER_VOLUME_CURRENT);
      out[n].price  = OrderGetDouble(ORDER_PRICE_OPEN);
      out[n].sl     = OrderGetDouble(ORDER_SL);
      out[n].tp     = OrderGetDouble(ORDER_TP);
   }
}

int FindPos(PosState &a[], ulong t)
{
   for(int i = 0; i < ArraySize(a); i++) if(a[i].ticket == t) return i;
   return -1;
}
int FindOrd(OrdState &a[], ulong t)
{
   for(int i = 0; i < ArraySize(a); i++) if(a[i].ticket == t) return i;
   return -1;
}

// A vanished pending order is either cancelled/expired or filled.
// Filled ones are NOT reported as deleted: the new position produces an "open".
bool OrderWasFilled(ulong t)
{
   if(!HistoryOrderSelect(t)) return false;
   long st = HistoryOrderGetInteger(t, ORDER_STATE);
   return (st == ORDER_STATE_FILLED || st == ORDER_STATE_PARTIAL);
}

//+------------------------------------------------------------------+
//| Event emission                                                    |
//+------------------------------------------------------------------+
void Emit(string type, ulong ticket, string sym, string side,
          double vol, double prevVol, double price, double sl, double tp,
          double profit = 0, bool hasProfit = false)
{
   string key = (string)AccountInfoInteger(ACCOUNT_LOGIN) + "-" + (string)NextSeq();
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
   j += "\"master_balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   j += "\"master_equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   j += "\"event_time\":" + (string)(long)TimeGMT() + ",";
   j += "\"platform\":\"mt5\"}";
   CP_Enqueue("/api/v1/events", j);
   CP_Dbg("event " + type + " #" + (string)ticket + " " + sym);
}

void EmitPos(string type, PosState &p, double vol, double prevVol)
{
   string side = (p.type == POSITION_TYPE_BUY) ? "buy" : "sell";
   Emit(type, p.ticket, p.symbol, side, vol, prevVol, p.price, p.sl, p.tp);
}

// Net result of a position (profit + swap + commission) once it has closed.
bool ClosedProfit(ulong posTicket, double &profit)
{
   if(!HistorySelectByPosition(posTicket)) return false;
   int n = HistoryDealsTotal();
   double sum = 0;
   bool closedDeal = false;
   for(int i = 0; i < n; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT) closedDeal = true;
      sum += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_SWAP) + HistoryDealGetDouble(d, DEAL_COMMISSION);
   }
   profit = sum;
   return closedDeal;
}

void EmitClose(PosState &p)
{
   double pr = 0;
   bool has = ClosedProfit(p.ticket, pr);
   string side = (p.type == POSITION_TYPE_BUY) ? "buy" : "sell";
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

      if(cur[i].type != g_pos[j].type)   // netting reversal
      {
         EmitClose(g_pos[j]);
         EmitPos("open",  cur[i],   cur[i].volume, 0);
         continue;
      }

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
   j += "\"role\":\"master\",\"platform\":\"mt5\",";
   j += "\"login\":" + (string)AccountInfoInteger(ACCOUNT_LOGIN) + ",";
   j += "\"server\":\"" + CP_Esc(AccountInfoString(ACCOUNT_SERVER)) + "\",";
   j += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   j += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   j += "\"open_tickets\":[" + tickets + "],";
   j += "\"pending_tickets\":[" + pend + "],";
   j += "\"positions\":" + CP_PositionsJson() + ",";
   j += "\"quotes\":" + QuotesJson() + ",";
   j += "\"outbox\":" + (string)ArraySize(g_out) + ",";
   j += "\"ts\":" + (string)(long)TimeGMT() + "}";

   string resp;
   int code = CP_Http("POST", "/api/v1/heartbeat", j, resp);
   Comment(StringFormat("Copier MASTER | server: %s | open: %d | queued: %d",
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
//| Dashboard orders: open / close one position / close all           |
//| Command line (17 pipe-separated fields):                          |
//| id|action|key|symbol|side|vol|price|sl|tp|lotMode|lotValue|       |
//| masterBalance|reverse|ratio|createdEpoch|slippage|suffix           |
//| For close_ticket, key is the broker ticket.                        |
//| Trades opened here are reported to the server like any other,     |
//| so the followers copy them through their links.                   |
//+------------------------------------------------------------------+
struct MCmd { long id; string action; ulong key; string symbol; string side; double volume; double sl; double tp; long created; int slip; };
struct MRes { string status; string msg; ulong ticket; double volume; double price; };

string GVLast() { return "CPL_" + (string)AccountInfoInteger(ACCOUNT_LOGIN); }

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
      c.key     = (ulong)StringToInteger(p[2]);
      c.symbol  = p[3];
      c.side    = p[4];
      c.volume  = StringToDouble(p[5]);
      c.sl      = StringToDouble(p[7]);
      c.tp      = StringToDouble(p[8]);
      c.created = StringToInteger(p[14]);
      c.slip    = (np > 15) ? (int)StringToInteger(p[15]) : 0;

      MRes r;
      r.status = "failed"; r.msg = ""; r.ticket = 0; r.volume = 0; r.price = 0;

      // Replay the original result for redelivered commands.
      long login = (long)AccountInfoInteger(ACCOUNT_LOGIN);
      long last = (long)GlobalVariableGet(GVLast());

      if(c.id <= last)
      {
         int saved = CP_ResultFind(
            "master", login, c.id,
            r.status, r.msg, r.ticket, r.volume, r.price
         );

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
         bool stored = CP_ResultSave(
            "master", login, c.id,
            r.status, r.msg, r.ticket, r.volume, r.price
         );

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
   if(c.action == "open")              MOpen(c, r);
   else if(c.action == "close_ticket") MCloseTicket(c, r);
   else if(c.action == "close_all")    MCloseAll(r);
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

void MOpen(MCmd &c, MRes &r)
{
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   { r.status = "skipped"; r.msg = "trading not allowed (enable Algo Trading and EA trading)"; return; }

   if(InpMaxCmdAgeSec > 0 && c.created > 0 && (long)TimeGMT() - c.created > InpMaxCmdAgeSec)
   { r.status = "skipped"; r.msg = "stale command"; return; }

   if(c.side != "buy" && c.side != "sell") { r.msg = "bad side " + c.side; return; }
   string sym = CP_FindSymbol(c.symbol, InpPrefix, InpSuffix);
   if(sym == "") { r.msg = "symbol not found: " + c.symbol; return; }

   bool isBuy = (c.side == "buy");
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double mn   = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double mx   = MathMin(SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX), InpMaxOrderLot);
   if(step <= 0) step = 0.01;
   double vol = MathFloor(MathMin(c.volume, mx) / step + 1e-9) * step;
   if(vol < mn) { r.status = "skipped"; r.msg = "lot below broker minimum"; return; }
   vol = NormalizeDouble(vol, (int)MathMax(0, MathRound(-MathLog10(step))));

   // keep SL/TP at least the broker's minimum distance away
   int    dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double md = (double)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(sym, SYMBOL_POINT);
   double ref = isBuy ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK);
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

   g_trade.SetTypeFillingBySymbol(sym);
   g_trade.SetDeviationInPoints(c.slip > 0 ? c.slip : InpSlippagePts);
   bool ok = false;
   for(int a = 0; a < 3; a++)
   {
      double px = isBuy ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID);
      ok = isBuy ? g_trade.Buy(vol, sym, px, sl, tp, "ML:dash") : g_trade.Sell(vol, sym, px, sl, tp, "ML:dash");
      if(ok && CP_TradeDone(g_trade.ResultRetcode())) break;
      uint rc = g_trade.ResultRetcode();
      if(rc != TRADE_RETCODE_REQUOTE && rc != TRADE_RETCODE_PRICE_CHANGED && rc != TRADE_RETCODE_PRICE_OFF) break;
      Sleep(150);
   }
   if(!ok || !CP_TradeDone(g_trade.ResultRetcode()))
   { r.msg = StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription()); return; }

   ulong pos = g_trade.ResultOrder();
   ulong deal = g_trade.ResultDeal();
   if(deal > 0 && HistoryDealSelect(deal)) pos = (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);
   r.status = "executed"; r.ticket = pos; r.volume = g_trade.ResultVolume(); r.price = g_trade.ResultPrice();
}

void MCloseTicket(MCmd &c, MRes &r)
{
   if(!PositionSelectByTicket(c.key)) { r.status = "skipped"; r.msg = "no open position with that ticket"; return; }
   double vol = PositionGetDouble(POSITION_VOLUME);
   g_trade.SetTypeFillingBySymbol(PositionGetString(POSITION_SYMBOL));
   bool ok = false;
   for(int a = 0; a < 3; a++)
   {
      ok = g_trade.PositionClose(c.key, c.slip > 0 ? c.slip : InpSlippagePts);
      if(ok && CP_TradeFullyDone(g_trade.ResultRetcode())) break;
      uint rc = g_trade.ResultRetcode();
      if(rc != TRADE_RETCODE_REQUOTE && rc != TRADE_RETCODE_PRICE_CHANGED && rc != TRADE_RETCODE_PRICE_OFF) break;
      Sleep(150);
   }
   if(!ok || !CP_TradeFullyDone(g_trade.ResultRetcode()))
   { r.msg = StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription()); return; }
   r.status = "executed"; r.ticket = c.key; r.volume = vol; r.price = g_trade.ResultPrice();
}

void MCloseAll(MRes &r)
{
   int closed = 0, deleted = 0, failed = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;

      g_trade.SetTypeFillingBySymbol(PositionGetString(POSITION_SYMBOL));
      bool ok = g_trade.PositionClose(t, InpSlippagePts);

      if(ok && CP_TradeFullyDone(g_trade.ResultRetcode())) closed++;
      else failed++;
   }

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong o = OrderGetTicket(i);
      if(o == 0) continue;

      bool ok = g_trade.OrderDelete(o);
      if(ok && CP_TradeDeleted(g_trade.ResultRetcode())) deleted++;
      else failed++;
   }

   r.status = (failed == 0) ? "executed" : "failed";
   r.msg = StringFormat("closed %d, deleted pending %d, failed %d",
                        closed, deleted, failed);
}
