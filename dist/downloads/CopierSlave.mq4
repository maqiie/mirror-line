//+------------------------------------------------------------------+
//| CopierSlave.mq4  (MT4 version)                                    |
//| Receives commands from Rails and executes them intelligently.     |
//|                                                                    |
//| The "brain" lives here: it decides HOW and WHETHER each command   |
//| is executed on THIS account (sizing, margin, stops, slippage,     |
//| spread, daily loss, symbol mapping, retries, duplicate defence).  |
//|                                                                    |
//| MT4 specifics handled here:                                        |
//|  - a partial close gives the remainder a NEW ticket; the master->  |
//|    slave ticket map is updated to follow it.                       |
//|  - a filled pending order keeps its ticket (becomes a position).   |
//+------------------------------------------------------------------+
#property copyright "THM Technologies Africa"
#property version   "1.00"
#property strict
#property description "Trade copier - SLAVE (MT4). Allow WebRequest to your server URL."

#include "CopierCommon4.mqh"

//--- Server
input string InpServerUrl      = "https://your-app.example.com";
input string InpToken          = "";
input int    InpPollMs         = 250;
input int    InpHeartbeatSec   = 5;

//--- Execution
input int    InpMagic          = 770077;
input int    InpSlippagePts    = 30;
input int    InpMaxDriftPts    = 0;      // skip open if price moved > N points vs master (0 = off)
input int    InpMaxCmdAgeSec   = 15;     // skip stale open/add/pending commands (0 = off)
input int    InpMaxSpreadPts   = 0;      // skip open if spread > N points (0 = off)
input int    InpRetries        = 3;
input bool   InpCopySLTP       = true;
input bool   InpCloseAllAnyMagic = true; // dashboard "close all" also closes trades you opened by hand
input string InpQuoteSymbols   = "EURUSD,GBPUSD,USDJPY,XAUUSD,US30";  // prices shown on the dashboard

//--- Symbols
input string InpPrefix         = "";
input string InpSuffix         = "";
input string InpSymbolMap      = "";     // e.g. GOLD=XAUUSD;US30=DJ30

//--- Sizing and risk
input double InpMaxLot         = 50.0;           // defaults; the dashboard's Risk page overrides them
input bool   InpRoundUpToMin   = false;  // below-min lots: false = skip, true = use min lot
input int    InpMaxPositions   = 30;
input double InpMinMarginLevel = 150.0;  // % (0 = off)
input double InpUseMarginPct   = 90.0;   // one trade may use at most this % of free margin
input double InpMaxDailyLossPct= 5.0;    // 0 = off
input bool   InpCloseAllOnDailyLoss = false;
input bool   InpDebug          = false;

struct SlaveCmd
{
   long   id; string action; int mticket; string symbol; string side;
   double volume; double price; double sl; double tp;
   string lotMode; double lotValue; double mBalance;
   bool   reverse; double ratio; long created;
   int    slip;      // per-link max slippage in points (0 = use input)
   string suffix;    // per-link symbol suffix
};
struct SlaveRes { string status; string msg; int ticket; double volume; double price; };

long   g_login = 0;
bool   g_kill = false, g_pause = false, g_dailyHalt = false;
ulong  g_lastHb = 0;
string g_mapFrom[], g_mapTo[];
string g_cacheFrom[], g_cacheTo[];
int    g_dayKey = 0;
double g_dayStartEq = 0;
// live risk limits (start from the inputs, replaced by the dashboard's values via heartbeat)
double g_maxLot = 0, g_minMargin = 0, g_dailyLossPct = 0;
int    g_maxPositions = 0, g_maxSpread = 0;

//--- names of terminal global variables used as a crash-safe ticket map
string GVPos(int mt)   { return "CPP_" + (string)g_login + "_" + (string)mt; }
string GVOrd(int mt)   { return "CPO_" + (string)g_login + "_" + (string)mt; }
string GVLast()        { return "CPL_" + (string)g_login; }
string Tag(int mt)     { return "CP:" + (string)mt; }

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpToken) == 0 || StringLen(InpServerUrl) == 0)
   {
      Alert("Copier slave: set InpServerUrl and InpToken.");
      return INIT_PARAMETERS_INCORRECT;
   }
   g_login = AccountNumber();
   g_maxLot = InpMaxLot; g_minMargin = InpMinMarginLevel; g_dailyLossPct = InpMaxDailyLossPct;
   g_maxPositions = InpMaxPositions; g_maxSpread = InpMaxSpreadPts;
   CP_Init(InpServerUrl, InpToken, 3000, InpDebug);
   ParseMap();

   AdoptOrphans();
   RollDay(true);
   EventSetMillisecondTimer(MathMax(50, InpPollMs));
   CP_Log("Slave started on account " + (string)g_login);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

void OnTimer()
{
   RollDay(false);
   CheckDailyLoss();
   CP_FlushOutbox();
   PollCommands();
   if(CP_NowMs() - g_lastHb >= (ulong)InpHeartbeatSec * 1000)
   {
      Heartbeat();
      g_lastHb = CP_NowMs();
   }
}

//+------------------------------------------------------------------+
//| Command intake                                                    |
//| Line: id|action|mticket|symbol|side|vol|price|sl|tp|lotMode|      |
//|       lotValue|masterBalance|reverse|ratio|createdEpoch            |
//+------------------------------------------------------------------+
bool ParseCmd(string line, SlaveCmd &c)
{
   string p[];
   int n = StringSplit(line, '|', p);
   if(n < 15) return false;
   c.id       = StringToInteger(p[0]);
   c.action   = p[1];
   c.mticket  = (int)StringToInteger(p[2]);
   c.symbol   = p[3];
   c.side     = p[4];
   c.volume   = StringToDouble(p[5]);
   c.price    = StringToDouble(p[6]);
   c.sl       = StringToDouble(p[7]);
   c.tp       = StringToDouble(p[8]);
   c.lotMode  = p[9];
   c.lotValue = StringToDouble(p[10]);
   c.mBalance = StringToDouble(p[11]);
   c.reverse  = (p[12] == "1");
   c.ratio    = StringToDouble(p[13]);
   c.created  = StringToInteger(p[14]);
   c.slip     = (n > 15) ? (int)StringToInteger(p[15]) : 0;
   c.suffix   = (n > 16) ? p[16] : "";
   return true;
}

void PollCommands()
{
   string resp;
   int code = CP_Http("GET", "/api/v1/commands/pending?limit=20", "", resp);
   if(code != 200) return;

   string lines[];
   int n = CP_Lines(resp, lines);
   for(int i = 0; i < n; i++)
   {
      if(StringLen(lines[i]) < 5) continue;
      SlaveCmd c;
      if(!ParseCmd(lines[i], c)) { CP_Log("Bad command line: " + lines[i]); continue; }

      SlaveRes r;
      r.status = "failed"; r.msg = ""; r.ticket = 0; r.volume = 0; r.price = 0;

      // Replay the original result for redelivered commands.
      long login = g_login;
      long last = (long)GlobalVariableGet(GVLast());

      if(c.id <= last)
      {
         int saved = CP_ResultFind("slave", login, c.id,
                                   r.status, r.msg, r.ticket, r.volume, r.price);

         if(saved == 0)
            SetRes(r, "skipped", "already processed");
         else if(saved < 0)
         {
            CP_Log("Cannot inspect result ledger for command " + (string)c.id +
                   "; delaying acknowledgement.");
            continue;
         }
      }
      else
      {
         Execute(c, r);

         // Persist the result before advancing the processed marker.
         bool stored = CP_ResultSave("slave", login, c.id,
                                     r.status, r.msg, r.ticket, r.volume, r.price);
         if(!stored)
            CP_Log("WARNING: command " + (string)c.id +
                   " executed but its result could not be persisted.");

         GlobalVariableSet(GVLast(), (double)c.id);
      }

      Ack(c, r);
   }
   if(n > 0) CP_FlushOutbox();
}

void Execute(SlaveCmd &c, SlaveRes &r)
{
   string a = c.action;
   if(a == "open")                DoOpen(c, r, false);
   else if(a == "add")            DoOpen(c, r, true);
   else if(a == "close")          DoClose(c, r);
   else if(a == "partial_close")  DoPartial(c, r);
   else if(a == "modify")         DoModify(c, r);
   else if(a == "pending_place")  DoPendingPlace(c, r);
   else if(a == "pending_modify") DoPendingModify(c, r);
   else if(a == "pending_delete") DoPendingDelete(c, r);
   else if(a == "close_ticket")   DoCloseTicket(c, r);
   else if(a == "modify_ticket")  DoModifyTicket(c, r);
   else if(a == "close_all")      DoCloseAll(r, InpCloseAllAnyMagic);
   else                           SetRes(r, "failed", "unknown action " + a);
}

void SetRes(SlaveRes &r, string st, string msg) { r.status = st; r.msg = msg; }

void Ack(SlaveCmd &c, SlaveRes &r)
{
   string j = "{";
   j += "\"status\":\"" + r.status + "\",";
   j += "\"message\":\"" + CP_Esc(r.msg) + "\",";
   j += "\"slave_ticket\":" + (string)r.ticket + ",";
   j += "\"volume\":" + DoubleToString(r.volume, 8) + ",";
   j += "\"price\":" + DoubleToString(r.price, 8) + ",";
   j += "\"balance\":" + DoubleToString(AccountBalance(), 2) + ",";
   j += "\"equity\":" + DoubleToString(AccountEquity(), 2) + "}";
   CP_Enqueue("/api/v1/commands/" + (string)c.id + "/ack", j);
   CP_Dbg(StringFormat("cmd %I64d %s -> %s %s", c.id, c.action, r.status, r.msg));
}

//+------------------------------------------------------------------+
//| Symbol resolution: explicit map > prefix/suffix > exact > fuzzy   |
//+------------------------------------------------------------------+
void ParseMap()
{
   if(StringLen(InpSymbolMap) == 0) return;
   string pairs[];
   int n = StringSplit(InpSymbolMap, ';', pairs);
   for(int i = 0; i < n; i++)
   {
      string kv[];
      if(StringSplit(pairs[i], '=', kv) != 2) continue;
      StringTrimLeft(kv[0]); StringTrimRight(kv[0]);
      StringTrimLeft(kv[1]); StringTrimRight(kv[1]);
      int k = ArraySize(g_mapFrom);
      ArrayResize(g_mapFrom, k + 1); ArrayResize(g_mapTo, k + 1);
      g_mapFrom[k] = kv[0]; g_mapTo[k] = kv[1];
   }
}

string ResolveSymbol(string m, string linkSuffix = "")
{
   string suffix = (linkSuffix != "") ? linkSuffix : InpSuffix;
   string ckey = m + "|" + suffix;
   for(int i = 0; i < ArraySize(g_cacheFrom); i++)
      if(g_cacheFrom[i] == ckey) return g_cacheTo[i];

   string found = "";

   for(int i = 0; i < ArraySize(g_mapFrom) && found == ""; i++)
      if(g_mapFrom[i] == m && SymbolSelect(g_mapTo[i], true)) found = g_mapTo[i];

   if(found == "")
   {
      string c1 = InpPrefix + m + suffix;
      if(SymbolSelect(c1, true)) found = c1;
      else if(SymbolSelect(m, true)) found = m;
   }

   if(found == "")   // fuzzy: first 6 chars, shortest tradable match
   {
      string base = (StringLen(m) > 6) ? StringSubstr(m, 0, 6) : m;
      int total = SymbolsTotal(false), bestLen = 1000;
      for(int i = 0; i < total; i++)
      {
         string nm = SymbolName(i, false);
         if(StringFind(nm, base) < 0) continue;
         if(SymbolInfoInteger(nm, SYMBOL_TRADE_MODE) == SYMBOL_TRADE_MODE_DISABLED) continue;
         if(StringLen(nm) < bestLen) { bestLen = StringLen(nm); found = nm; }
      }
      if(found != "") SymbolSelect(found, true);
   }

   if(found != "")
   {
      int k = ArraySize(g_cacheFrom);
      ArrayResize(g_cacheFrom, k + 1); ArrayResize(g_cacheTo, k + 1);
      g_cacheFrom[k] = ckey; g_cacheTo[k] = found;
   }
   return found;
}

//+------------------------------------------------------------------+
//| Ticket map (master ticket -> my ticket)                           |
//+------------------------------------------------------------------+
int FindCopy(int mt)
{
   string k = GVPos(mt);
   if(GlobalVariableCheck(k))
   {
      int t = (int)GlobalVariableGet(k);
      if(CP_IsPos(t)) return t;
      // partially closed by hand/EA: MT4 gave the remainder a new ticket
      int rem = CP_FindRemainder(t, InpMagic, false);
      if(rem > 0) { GlobalVariableSet(k, (double)rem); return rem; }
      GlobalVariableDel(k);              // closed locally (SL/TP/stop-out)
   }
   string tag = Tag(mt);                  // fallback: comment tag
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() > OP_SELL) continue;
      if(OrderMagicNumber() == InpMagic && OrderComment() == tag)
      {
         int t = OrderTicket();
         GlobalVariableSet(k, (double)t);
         return t;
      }
   }
   return 0;
}

void AdoptOrphans()   // rebuilds the map if terminal globals were lost
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() > OP_SELL || OrderMagicNumber() != InpMagic) continue;
      string c = OrderComment();
      if(StringFind(c, "CP:") != 0) continue;
      int mt = (int)StringToInteger(StringSubstr(c, 3));
      if(mt > 0 && !GlobalVariableCheck(GVPos(mt))) GlobalVariableSet(GVPos(mt), (double)OrderTicket());
   }
}

int CountMine()
{
   int n = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() <= OP_SELL && OrderMagicNumber() == InpMagic) n++;
   }
   return n;
}

//+------------------------------------------------------------------+
//| Guards, sizing, stops                                             |
//+------------------------------------------------------------------+
double MarginLevel()   // % ; 0 when no margin is in use (same as MT5)
{
   double m = AccountMargin();
   return (m > 0) ? AccountEquity() / m * 100.0 : 0.0;
}

bool CanOpen(string &why)
{
   if(g_kill)       { why = "kill switch active";        return false; }
   if(g_pause)      { why = "copying paused";            return false; }
   if(g_dailyHalt)  { why = "daily loss limit reached";  return false; }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) || !AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
                    { why = "trading not allowed (terminal/account/EA)"; return false; }
   if(g_maxPositions > 0 && CountMine() >= g_maxPositions)
                    { why = "max positions reached"; return false; }
   if(g_minMargin > 0 && AccountMargin() > 0 && MarginLevel() < g_minMargin)
                    { why = "margin level too low"; return false; }
   return true;
}

double CalcVolume(SlaveCmd &c, string sym, bool isBuy, double entry, double sl)
{
   double v = 0;
   if(c.lotMode == "fixed")           v = c.lotValue;
   else if(c.lotMode == "multiplier") v = c.volume * c.lotValue;
   else if(c.lotMode == "balance_ratio")
   {
      if(c.mBalance <= 0) return -1;
      v = c.volume * (AccountBalance() / c.mBalance) * (c.lotValue > 0 ? c.lotValue : 1.0);
   }
   else if(c.lotMode == "risk_pct")   // lotValue = % of follower equity risked to SL
   {
      double equity = AccountEquity();
      if(equity <= 0 || c.lotValue <= 0 || c.lotValue > 100 || sl <= 0) return -1;

      double e = (entry > 0) ? entry : (isBuy ? MarketInfo(sym, MODE_ASK) : MarketInfo(sym, MODE_BID));
      if(e <= 0 || (isBuy && sl >= e) || (!isBuy && sl <= e)) return -1;

      // MT4 has no OrderCalcProfit: money lost per 1 lot between entry and SL via tick value/size.
      double ts = MarketInfo(sym, MODE_TICKSIZE);
      double tv = MarketInfo(sym, MODE_TICKVALUE);
      if(ts <= 0 || tv <= 0) return -1;
      double lossPerLot = MathAbs(e - sl) / ts * tv;
      if(lossPerLot <= 0) return -1;

      double riskMoney = equity * c.lotValue / 100.0;
      v = riskMoney / lossPerLot;
   }
   else return -1;
   return v;
}

// Risk-sized trades must never be rounded up to the broker minimum.
double NormVol(string sym, double v, bool strictRisk)
{
   double step = MarketInfo(sym, MODE_LOTSTEP);
   double mn   = MarketInfo(sym, MODE_MINLOT);
   double mx   = MarketInfo(sym, MODE_MAXLOT);
   if(step <= 0 || mn <= 0 || mx <= 0 || v <= 0) return 0;
   if(g_maxLot > 0) mx = MathMin(mx, g_maxLot);
   if(mx < mn) return 0;

   v = MathMin(v, mx);
   v = MathFloor(v / step + 1e-9) * step;

   if(v < mn)
   {
      if(strictRisk || !InpRoundUpToMin) return 0;
      v = mn;
   }

   // Correct precision for steps such as 0.25, 0.001, and 0.01.
   int dg = 0;
   double scaledStep = step;
   while(dg < 8 && MathAbs(scaledStep - MathRound(scaledStep)) > 1e-8)
   {
      scaledStep *= 10.0;
      dg++;
   }
   return NormalizeDouble(v, dg);
}

double FitMargin(string sym, bool isBuy, double vol, bool strictRisk)
{
   // MT4 has no OrderCalcMargin: use the broker's margin per 1 lot.
   double need = MarketInfo(sym, MODE_MARGINREQUIRED) * vol;
   double budget = AccountFreeMargin() * InpUseMarginPct / 100.0;
   if(need <= 0 || need <= budget) return vol;
   if(budget <= 0) return 0;

   return NormVol(sym, vol * budget / need, strictRisk);
}

void FixStops(string sym, bool isBuy, double ref, double &sl, double &tp)
{
   double pt = MarketInfo(sym, MODE_POINT);
   int    dg = (int)MarketInfo(sym, MODE_DIGITS);
   double md = MarketInfo(sym, MODE_STOPLEVEL) * pt;
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
}

bool CmdIsStale(SlaveCmd &c, string &why)
{
   if(InpMaxCmdAgeSec <= 0 || c.created <= 0) return false;
   long age = (long)TimeGMT() - c.created;
   if(age > InpMaxCmdAgeSec) { why = StringFormat("stale command (%I64d s old)", age); return true; }
   return false;
}

//+------------------------------------------------------------------+
//| Actions                                                           |
//+------------------------------------------------------------------+

// Cancel any remaining pending order for this master ticket.
// Returns true only when the order is confirmed inactive.
bool CancelRemainingPending(int mt)
{
   string k = GVOrd(mt);
   if(!GlobalVariableCheck(k)) return true;

   int o = (int)GlobalVariableGet(k);

   // Not a live pending any more (cancelled, or filled into the position): nothing to cancel.
   if(!CP_IsPending(o))
   {
      GlobalVariableDel(k);
      return true;
   }

   int err;
   bool deleted = CP_DeleteOrder(o, err);
   if(!deleted && CP_IsPending(o)) return false;   // still active and could not delete

   GlobalVariableDel(k);
   return true;
}

// Returns: 1 = adopted, 0 = no pending copy / successfully cancelled,
//         -1 = unresolved or cancellation failed (do not open a market duplicate).
int ResolvePendingForOpen(int mt, int &posTicket)
{
   string k = GVOrd(mt);
   if(!GlobalVariableCheck(k)) return 0;

   int o = (int)GlobalVariableGet(k);

   if(!OrderSelect(o, SELECT_BY_TICKET)) return -1;   // unknown: refuse to duplicate

   if(OrderCloseTime() == 0)
   {
      // MT4: a filled pending keeps its ticket and is now a position -> adopt it.
      if(OrderType() <= OP_SELL)
      {
         posTicket = o;
         GlobalVariableSet(GVPos(mt), (double)o);
         GlobalVariableDel(k);
         return 1;
      }

      // Still pending: cancel it before the market-open command proceeds.
      int err;
      if(CP_DeleteOrder(o, err))
      {
         GlobalVariableDel(k);
         return 0;
      }

      // It may have filled between selection and deletion.
      if(CP_IsPos(o))
      {
         posTicket = o;
         GlobalVariableSet(GVPos(mt), (double)o);
         GlobalVariableDel(k);
         return 1;
      }
      return -1;
   }

   // Closed history record. A closed pending-type record = cancelled/expired: it never filled.
   if(OrderType() > OP_SELL)
   {
      GlobalVariableDel(k);
      return 0;
   }
   // It filled and the position is already gone: cannot adopt, do not duplicate.
   return -1;
}

void DoOpen(SlaveCmd &c, SlaveRes &r, bool isAdd)
{
   if(!isAdd)
   {
      int ex = FindCopy(c.mticket);
      if(ex > 0)
      {
         if(!CancelRemainingPending(c.mticket))
         {
            SetRes(r, "failed", "existing copied position found, but remaining pending order could not be cancelled");
            r.ticket = ex;
            return;
         }
         SetRes(r, "skipped", "already copied; remaining pending order cleared");
         r.ticket = ex;
         return;
      }
      int adopted = 0;
      int pendingResult = ResolvePendingForOpen(c.mticket, adopted);
      if(pendingResult > 0)
      { SetRes(r, "executed", "adopted filled pending order"); r.ticket = adopted; return; }
      if(pendingResult < 0)
      { SetRes(r, "failed", "pending order state could not be resolved; refusing duplicate market entry"); return; }
   }

   string why;
   if(!CanOpen(why))        { SetRes(r, "skipped", why); return; }
   if(CmdIsStale(c, why))   { SetRes(r, "skipped", why); return; }

   string sym = ResolveSymbol(c.symbol, c.suffix);
   if(sym == "")            { SetRes(r, "failed", "symbol not found: " + c.symbol); return; }
   if(c.side != "buy" && c.side != "sell") { SetRes(r, "failed", "bad side " + c.side); return; }

   bool mBuy  = (c.side == "buy");
   bool isBuy = c.reverse ? !mBuy : mBuy;
   double pt  = MarketInfo(sym, MODE_POINT);
   double ask = MarketInfo(sym, MODE_ASK);
   double bid = MarketInfo(sym, MODE_BID);
   if(ask <= 0 || bid <= 0 || pt <= 0) { SetRes(r, "failed", "no price for " + sym); return; }

   if(g_maxSpread > 0 && (ask - bid) / pt > g_maxSpread)
   { SetRes(r, "skipped", StringFormat("spread %.0f pts too wide", (ask - bid) / pt)); return; }

   if(InpMaxDriftPts > 0 && c.price > 0)
   {
      double drift = MathAbs((mBuy ? ask : bid) - c.price) / pt;
      if(drift > InpMaxDriftPts)
      { SetRes(r, "skipped", StringFormat("price drifted %.0f pts from master", drift)); return; }
   }

   double sl = InpCopySLTP ? c.sl : 0, tp = InpCopySLTP ? c.tp : 0;
   if(c.reverse) { double t = sl; sl = tp; tp = t; }      // reversed trade: master SL is our TP
   FixStops(sym, isBuy, isBuy ? bid : ask, sl, tp);

   double vol = CalcVolume(c, sym, isBuy, 0, sl);
   if(vol < 0) { SetRes(r, "skipped", "cannot size lot (mode " + c.lotMode + "; risk mode needs an SL)"); return; }
   vol = NormVol(sym, vol, c.lotMode == "risk_pct");
   if(vol <= 0) { SetRes(r, "skipped", "lot below broker minimum or risk-safe volume unavailable"); return; }
   vol = FitMargin(sym, isBuy, vol, c.lotMode == "risk_pct");
   if(vol <= 0) { SetRes(r, "skipped", "not enough free margin"); return; }

   string cm = Tag(c.mticket);
   int ticket, err; double price;
   bool ok = CP_SendMarket(sym, isBuy, vol, sl, tp, cm, InpMagic, Dev(c), InpRetries, ticket, price, err);
   if(!ok)
   { SetRes(r, "failed", CP_Err(err)); return; }

   if(ticket > 0 && !GlobalVariableCheck(GVPos(c.mticket))) GlobalVariableSet(GVPos(c.mticket), (double)ticket);
   r.status = "executed"; r.ticket = ticket; r.volume = vol; r.price = price;
}

void DoClose(SlaveCmd &c, SlaveRes &r)   // always allowed, even under kill/pause/halt
{
   int t = FindCopy(c.mticket);
   if(t == 0 || !CP_IsPos(t)) { SetRes(r, "skipped", "no open copy (already closed?)"); return; }
   double vol = OrderLots();
   int err; double price;
   if(!CP_CloseOrder(t, vol, Dev(c), InpRetries, price, err))
   { SetRes(r, "failed", CP_Err(err)); return; }
   GlobalVariableDel(GVPos(c.mticket));
   r.status = "executed"; r.ticket = t; r.volume = vol; r.price = price;
}

void DoPartial(SlaveCmd &c, SlaveRes &r)
{
   int t = FindCopy(c.mticket);
   if(t == 0 || !CP_IsPos(t)) { SetRes(r, "skipped", "no open copy"); return; }
   string sym = OrderSymbol();
   double pv = OrderLots();
   if(c.ratio <= 0 || c.ratio > 1) { SetRes(r, "failed", "bad close ratio"); return; }

   double step = MarketInfo(sym, MODE_LOTSTEP), mn = MarketInfo(sym, MODE_MINLOT);
   if(step <= 0) step = 0.01;
   double vol = MathRound(pv * c.ratio / step) * step;
   int dg = (int)MathMax(0, MathRound(-MathLog10(step)));
   vol = NormalizeDouble(vol, dg);

   if(vol >= pv - step / 2) { DoClose(c, r); return; }          // effectively everything
   if(vol < mn)             { SetRes(r, "skipped", "partial amount below minimum lot"); return; }

   int err; double price;
   if(!CP_CloseOrder(t, vol, Dev(c), InpRetries, price, err))
   { SetRes(r, "failed", CP_Err(err)); return; }

   // MT4: the remainder has a NEW ticket ("from #t"). Keep the master->slave map pointing at it.
   int rem = CP_FindRemainder(t, InpMagic, false);
   if(rem > 0) GlobalVariableSet(GVPos(c.mticket), (double)rem);
   r.status = "executed"; r.ticket = (rem > 0 ? rem : t); r.volume = vol; r.price = price;
}

void DoModify(SlaveCmd &c, SlaveRes &r)
{
   if(!InpCopySLTP) { SetRes(r, "skipped", "SL/TP copying disabled"); return; }
   int t = FindCopy(c.mticket);
   if(t == 0 || !CP_IsPos(t)) { SetRes(r, "skipped", "no open copy"); return; }
   string sym = OrderSymbol();
   bool isBuy = (OrderType() == OP_BUY);
   double curSL = OrderStopLoss(), curTP = OrderTakeProfit();
   double sl = c.sl, tp = c.tp;
   if(c.reverse) { double x = sl; sl = tp; tp = x; }
   FixStops(sym, isBuy, isBuy ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK), sl, tp);

   double pt = MarketInfo(sym, MODE_POINT);
   if(MathAbs(sl - curSL) < pt / 2 && MathAbs(tp - curTP) < pt / 2)
   { SetRes(r, "skipped", "no change"); r.ticket = t; return; }

   int err;
   if(!CP_ModifyOrder(t, 0, sl, tp, InpRetries, err))
   { SetRes(r, "failed", CP_Err(err)); return; }
   r.status = "executed"; r.ticket = t;
}

void DoPendingPlace(SlaveCmd &c, SlaveRes &r)
{
   if(c.reverse) { SetRes(r, "skipped", "pending orders are not copied in reverse mode"); return; }
   string k = GVOrd(c.mticket);
   if(GlobalVariableCheck(k) && CP_IsPending((int)GlobalVariableGet(k)))
   { SetRes(r, "skipped", "pending already placed"); return; }

   string why;
   if(!CanOpen(why))      { SetRes(r, "skipped", why); return; }
   if(CmdIsStale(c, why)) { SetRes(r, "skipped", why); return; }

   string sym = ResolveSymbol(c.symbol, c.suffix);
   if(sym == "") { SetRes(r, "failed", "symbol not found: " + c.symbol); return; }

   bool isBuy = (StringFind(c.side, "buy") == 0);
   int dg = (int)MarketInfo(sym, MODE_DIGITS);
   double price = NormalizeDouble(c.price, dg);
   double sl = InpCopySLTP ? c.sl : 0, tp = InpCopySLTP ? c.tp : 0;
   FixStops(sym, isBuy, price, sl, tp);

   double vol = CalcVolume(c, sym, isBuy, price, sl);
   if(vol < 0) { SetRes(r, "skipped", "cannot size lot"); return; }
   vol = NormVol(sym, vol, c.lotMode == "risk_pct");
   if(vol <= 0) { SetRes(r, "skipped", "lot below broker minimum or risk-safe volume unavailable"); return; }

   int type;
   if(c.side == "buy_limit")       type = OP_BUYLIMIT;
   else if(c.side == "sell_limit") type = OP_SELLLIMIT;
   else if(c.side == "buy_stop")   type = OP_BUYSTOP;
   else if(c.side == "sell_stop")  type = OP_SELLSTOP;
   else { SetRes(r, "failed", "unsupported pending type " + c.side); return; }

   int o, err;
   if(!CP_SendPending(sym, type, vol, price, sl, tp, Tag(c.mticket), InpMagic, o, err))
   { SetRes(r, "failed", CP_Err(err)); return; }

   GlobalVariableSet(k, (double)o);
   r.status = "executed"; r.ticket = o; r.volume = vol; r.price = price;
}

void DoPendingModify(SlaveCmd &c, SlaveRes &r)
{
   string k = GVOrd(c.mticket);
   if(!GlobalVariableCheck(k)) { SetRes(r, "skipped", "no pending copy"); return; }
   int o = (int)GlobalVariableGet(k);
   if(!CP_IsPending(o)) { GlobalVariableDel(k); SetRes(r, "skipped", "pending no longer exists"); return; }
   string sym = OrderSymbol();
   bool isBuy = (StringFind(c.side, "buy") == 0);
   int dg = (int)MarketInfo(sym, MODE_DIGITS);
   double price = NormalizeDouble(c.price, dg);
   double sl = InpCopySLTP ? c.sl : 0, tp = InpCopySLTP ? c.tp : 0;
   FixStops(sym, isBuy, price, sl, tp);
   int err;
   if(!CP_ModifyOrder(o, price, sl, tp, InpRetries, err))
   { SetRes(r, "failed", CP_Err(err)); return; }
   r.status = "executed"; r.ticket = o; r.price = price;
}

void DoPendingDelete(SlaveCmd &c, SlaveRes &r)
{
   string k = GVOrd(c.mticket);
   if(!GlobalVariableCheck(k)) { SetRes(r, "skipped", "no pending copy"); return; }
   int o = (int)GlobalVariableGet(k);
   if(!CP_IsPending(o)) { GlobalVariableDel(k); SetRes(r, "skipped", "pending no longer exists"); return; }
   int err;
   if(!CP_DeleteOrder(o, err))
   { SetRes(r, "failed", CP_Err(err)); return; }
   GlobalVariableDel(k);
   r.status = "executed"; r.ticket = o;
}

// Close one position by its raw broker ticket (dashboard "x" button). Always allowed.
void DoCloseTicket(SlaveCmd &c, SlaveRes &r)
{
   if(!CP_IsPos(c.mticket)) { SetRes(r, "skipped", "no open copy (already closed?)"); return; }
   double vol = OrderLots();
   int err; double price;
   if(!CP_CloseOrder(c.mticket, vol, Dev(c), InpRetries, price, err))
   { SetRes(r, "failed", CP_Err(err)); return; }
   r.status = "executed"; r.ticket = c.mticket; r.volume = vol; r.price = price;
}

// Modify SL/TP on one raw broker position ticket (dashboard edit).
void DoModifyTicket(SlaveCmd &c, SlaveRes &r)
{
   if(!CP_IsPos(c.mticket))
   { SetRes(r, "skipped", "no open copy with that ticket"); return; }

   string sym = OrderSymbol();
   double oldSL = OrderStopLoss();
   double oldTP = OrderTakeProfit();
   double pt = MarketInfo(sym, MODE_POINT);

   if(MathAbs(c.sl - oldSL) < pt / 2 && MathAbs(c.tp - oldTP) < pt / 2)
   { SetRes(r, "skipped", "no change"); r.ticket = c.mticket; return; }

   int err;
   if(!CP_ModifyOrder(c.mticket, 0, c.sl, c.tp, InpRetries, err))
   { SetRes(r, "failed", CP_Err(err)); return; }

   r.status = "executed";
   r.ticket = c.mticket;
}

// anyMagic=false closes only copier trades (used by the daily-loss guard);
// anyMagic=true closes every position on the account (dashboard "close all").
void DoCloseAll(SlaveRes &r, bool anyMagic)
{
   int closed = 0, deleted = 0, failed = 0;

   // collect first: closing changes the pool while we iterate
   int tk[]; int ty[];
   ArrayResize(tk, 0); ArrayResize(ty, 0);
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(!anyMagic && OrderMagicNumber() != InpMagic) continue;
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
//| Daily loss protection (runs locally, works even if server is down)|
//+------------------------------------------------------------------+
int DayKey()
{
   datetime now = TimeCurrent();
   return TimeYear(now) * 10000 + TimeMonth(now) * 100 + TimeDay(now);
}

void RollDay(bool init)
{
   int k = DayKey();
   string gk = "CPD_" + (string)g_login, gq = "CPQ_" + (string)g_login;
   if(init && GlobalVariableCheck(gk) && (int)GlobalVariableGet(gk) == k)
   {
      g_dayKey = k;
      g_dayStartEq = GlobalVariableGet(gq);
      return;
   }
   if(k != g_dayKey)
   {
      g_dayKey = k;
      g_dayStartEq = AccountEquity();
      g_dailyHalt = false;
      GlobalVariableSet(gk, (double)k);
      GlobalVariableSet(gq, g_dayStartEq);
   }
}

void CheckDailyLoss()
{
   if(g_dailyLossPct <= 0 || g_dayStartEq <= 0 || g_dailyHalt) return;
   double dd = (g_dayStartEq - AccountEquity()) / g_dayStartEq * 100.0;
   if(dd >= g_dailyLossPct)
   {
      g_dailyHalt = true;
      CP_Log(StringFormat("Daily loss %.2f%% reached: new trades blocked until next day", dd));
      if(InpCloseAllOnDailyLoss) { SlaveRes r; DoCloseAll(r, false); }
   }
}

//+------------------------------------------------------------------+
//| Heartbeat: report state + every master ticket I hold, receive      |
//| KILL / PAUSE flags. Server uses the list to reconcile.             |
//+------------------------------------------------------------------+
int Dev(SlaveCmd &c) { return (c.slip > 0) ? c.slip : InpSlippagePts; }

// "max_lot=5.0;max_open=10;daily_loss_pct=5.0;min_margin_level=150.0;max_spread=30"
void ApplyGuards(string spec)
{
   string items[];
   int n = StringSplit(spec, ';', items);
   for(int i = 0; i < n; i++)
   {
      string kv[];
      if(StringSplit(items[i], '=', kv) != 2) continue;
      double v = StringToDouble(kv[1]);
      if(kv[0] == "max_lot")               g_maxLot = v;
      else if(kv[0] == "max_open")         g_maxPositions = (int)v;
      else if(kv[0] == "daily_loss_pct")   g_dailyLossPct = v;
      else if(kv[0] == "min_margin_level") g_minMargin = v;
      else if(kv[0] == "max_spread")       g_maxSpread = (int)v;
   }
}

string QuotesJson()
{
   string bases[];
   int n = StringSplit(InpQuoteSymbols, ',', bases);
   string s = "";
   for(int i = 0; i < n; i++)
   {
      StringTrimLeft(bases[i]); StringTrimRight(bases[i]);
      if(bases[i] == "") continue;
      string item = CP_QuoteItem(bases[i], ResolveSymbol(bases[i], ""));
      if(item == "") continue;
      if(s != "") s += ",";
      s += item;
   }
   return "{" + s + "}";
}

string CopiesList(int &count)
{
   count = 0;
   string pre = "CPP_" + (string)g_login + "_";
   string s = "";
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
   {
      string nm = GlobalVariableName(i);
      if(StringFind(nm, pre) != 0) continue;
      int mt = (int)StringToInteger(StringSubstr(nm, StringLen(pre)));
      int st = (int)GlobalVariableGet(nm);
      if(!CP_IsPos(st))
      {
         int rem = CP_FindRemainder(st, InpMagic, false);   // partially closed: follow the new ticket
         if(rem > 0) { GlobalVariableSet(nm, (double)rem); st = rem; }
         else { GlobalVariableDel(nm); continue; }           // closed locally
         if(!CP_IsPos(st)) continue;
      }
      if(count > 0) s += ",";
      s += "{\"m\":" + (string)mt + ",\"s\":" + (string)st +
           ",\"v\":" + DoubleToString(OrderLots(), 8) +
           ",\"p\":" + DoubleToString(OrderProfit(), 2) + "}";
      count++;
   }
   return "[" + s + "]";
}

void Heartbeat()
{
   AdoptOrphans();
   int cnt = 0;
   string copies = CopiesList(cnt);

   string j = "{";
   j += "\"role\":\"slave\",\"platform\":\"mt4\",";
   j += "\"login\":" + (string)g_login + ",";
   j += "\"server\":\"" + CP_Esc(AccountServer()) + "\",";
   j += "\"balance\":" + DoubleToString(AccountBalance(), 2) + ",";
   j += "\"equity\":" + DoubleToString(AccountEquity(), 2) + ",";
   j += "\"margin_level\":" + DoubleToString(MarginLevel(), 2) + ",";
   j += "\"daily_halt\":" + (g_dailyHalt ? "true" : "false") + ",";
   j += "\"copies\":" + copies + ",";
   j += "\"positions\":" + CP_PositionsJson() + ",";
   j += "\"quotes\":" + QuotesJson() + ",";
   j += "\"outbox\":" + (string)ArraySize(g_out) + ",";
   j += "\"ts\":" + (string)(long)TimeGMT() + "}";

   string resp;
   int code = CP_Http("POST", "/api/v1/heartbeat", j, resp);
   if(code == 200)
   {
      string ln[];
      int n = CP_Lines(resp, ln);
      for(int i = 0; i < n; i++)
      {
         string kv[];
         if(StringSplit(ln[i], '|', kv) < 2) continue;
         if(kv[0] == "KILL")       g_kill  = (kv[1] == "1");
         else if(kv[0] == "PAUSE") g_pause = (kv[1] == "1");
         else if(kv[0] == "GUARDS") ApplyGuards(kv[1]);
      }
   }
   Comment(StringFormat("Copier SLAVE (MT4) | server: %s | copies: %d | kill:%s pause:%s dailyHalt:%s",
           code == 200 ? "OK" : "ERR " + (string)code, cnt,
           g_kill ? "ON" : "off", g_pause ? "ON" : "off", g_dailyHalt ? "ON" : "off"));
}
//+------------------------------------------------------------------+
