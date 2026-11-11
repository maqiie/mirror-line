//+------------------------------------------------------------------+
//| CopierSlave.mq5                                                   |
//| Receives commands from Rails and executes them intelligently.     |
//|                                                                    |
//| The "brain" lives here: it decides HOW and WHETHER each command   |
//| is executed on THIS account (sizing, margin, stops, slippage,     |
//| spread, daily loss, symbol mapping, retries, duplicate defence).  |
//+------------------------------------------------------------------+
#property copyright "THM Technologies Africa"
#property version   "1.00"
#property strict
#property description "Trade copier - SLAVE. Allow WebRequest to your server URL."

#include <Trade\Trade.mqh>
#include "CopierCommon.mqh"

input group "Server"
input string InpServerUrl      = "https://your-app.example.com";
input string InpToken          = "";
input int    InpPollMs         = 250;
input int    InpHeartbeatSec   = 5;

input group "Execution"
input long   InpMagic          = 770077;
input int    InpSlippagePts    = 30;
input int    InpMaxDriftPts    = 0;      // skip open if price moved > N points vs master (0 = off)
input int    InpMaxCmdAgeSec   = 15;     // skip stale open/add/pending commands (0 = off)
input int    InpMaxSpreadPts   = 0;      // skip open if spread > N points (0 = off)
input int    InpRetries        = 3;
input bool   InpCopySLTP       = true;
input bool   InpCloseAllAnyMagic = true; // dashboard "close all" also closes trades you opened by hand
input string InpQuoteSymbols   = "EURUSD,GBPUSD,USDJPY,XAUUSD,US30";  // prices shown on the dashboard

input group "Symbols"
input string InpPrefix         = "";
input string InpSuffix         = "";
input string InpSymbolMap      = "";     // e.g. GOLD=XAUUSD;US30=DJ30

input group "Sizing and risk"
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
   long   id; string action; ulong mticket; string symbol; string side;
   double volume; double price; double sl; double tp;
   string lotMode; double lotValue; double mBalance;
   bool   reverse; double ratio; long created;
   int    slip;      // per-link max slippage in points (0 = use input)
   string suffix;    // per-link symbol suffix
};
struct SlaveRes { string status; string msg; ulong ticket; double volume; double price; };

CTrade g_trade;
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
string GVPos(ulong mt) { return "CPP_" + (string)g_login + "_" + (string)mt; }
string GVOrd(ulong mt) { return "CPO_" + (string)g_login + "_" + (string)mt; }
string GVLast()        { return "CPL_" + (string)g_login; }
string Tag(ulong mt)   { return "CP:" + (string)mt; }

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpToken) == 0 || StringLen(InpServerUrl) == 0)
   {
      Alert("Copier slave: set InpServerUrl and InpToken.");
      return INIT_PARAMETERS_INCORRECT;
   }
   g_login = AccountInfoInteger(ACCOUNT_LOGIN);
   g_maxLot = InpMaxLot; g_minMargin = InpMinMarginLevel; g_dailyLossPct = InpMaxDailyLossPct;
   g_maxPositions = InpMaxPositions; g_maxSpread = InpMaxSpreadPts;
   CP_Init(InpServerUrl, InpToken, 3000, InpDebug);
   ParseMap();

   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpSlippagePts);
   g_trade.SetAsyncMode(false);

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
   if(GetTickCount64() - g_lastHb >= (ulong)InpHeartbeatSec * 1000)
   {
      Heartbeat();
      g_lastHb = GetTickCount64();
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
   c.mticket  = (ulong)StringToInteger(p[2]);
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
      long login = (long)g_login;
      long last = (long)GlobalVariableGet(GVLast());

      if(c.id <= last)
      {
         int saved = CP_ResultFind(
            "slave", login, c.id,
            r.status, r.msg, r.ticket, r.volume, r.price
         );

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
         bool stored = CP_ResultSave(
            "slave", login, c.id,
            r.status, r.msg, r.ticket, r.volume, r.price
         );

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
   j += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   j += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + "}";
   CP_Enqueue("/api/v1/commands/" + (string)c.id + "/ack", j);
   CP_Dbg(StringFormat("cmd %d %s -> %s %s", c.id, c.action, r.status, r.msg));
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
ulong FindCopy(ulong mt)
{
   string k = GVPos(mt);
   if(GlobalVariableCheck(k))
   {
      ulong t = (ulong)GlobalVariableGet(k);
      if(PositionSelectByTicket(t)) return t;
      GlobalVariableDel(k);              // closed locally (SL/TP/stop-out)
   }
   string tag = Tag(mt);                  // fallback: comment tag
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetInteger(POSITION_MAGIC) == InpMagic &&
         PositionGetString(POSITION_COMMENT) == tag)
      {
         GlobalVariableSet(k, (double)t);
         return t;
      }
   }
   return 0;
}

void AdoptOrphans()   // rebuilds the map if terminal globals were lost
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      string c = PositionGetString(POSITION_COMMENT);
      if(StringFind(c, "CP:") != 0) continue;
      ulong mt = (ulong)StringToInteger(StringSubstr(c, 3));
      if(mt > 0 && !GlobalVariableCheck(GVPos(mt))) GlobalVariableSet(GVPos(mt), (double)t);
   }
}

int CountMine()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetInteger(POSITION_MAGIC) == InpMagic) n++;
   }
   return n;
}

//+------------------------------------------------------------------+
//| Guards, sizing, stops                                             |
//+------------------------------------------------------------------+
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
   if(g_minMargin > 0 && AccountInfoDouble(ACCOUNT_MARGIN) > 0 &&
      AccountInfoDouble(ACCOUNT_MARGIN_LEVEL) < g_minMargin)
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
      v = c.volume * (AccountInfoDouble(ACCOUNT_BALANCE) / c.mBalance) * (c.lotValue > 0 ? c.lotValue : 1.0);
   }
   else if(c.lotMode == "risk_pct")   // lotValue = % of follower equity risked to SL
   {
      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      if(equity <= 0 || c.lotValue <= 0 || c.lotValue > 100 || sl <= 0) return -1;

      double e = (entry > 0) ? entry : (isBuy ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID));
      if(e <= 0 || (isBuy && sl >= e) || (!isBuy && sl <= e)) return -1;

      double pl = 0;
      if(!OrderCalcProfit(isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, sym, 1.0, e, sl, pl)) return -1;
      // A valid stop must produce a loss for the requested trade direction.
      if(pl >= 0) return -1;

      double lossPerLot = -pl;
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
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double mn   = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double mx   = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0 || mn <= 0 || mx <= 0 || v <= 0) return 0;
   if(g_maxLot > 0) mx = MathMin(mx, g_maxLot);
   if(mx < mn) return 0;

   v = MathMin(v, mx);
   v = MathFloor(v / step) * step;

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
   double price = isBuy ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID);
   double need = 0;
   if(!OrderCalcMargin(isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, sym, vol, price, need)) return vol;

   double budget = AccountInfoDouble(ACCOUNT_MARGIN_FREE) * InpUseMarginPct / 100.0;
   if(need <= 0 || need <= budget) return vol;
   if(budget <= 0) return 0;

   return NormVol(sym, vol * budget / need, strictRisk);
}

void FixStops(string sym, bool isBuy, double ref, double &sl, double &tp)
{
   double pt = SymbolInfoDouble(sym, SYMBOL_POINT);
   int    dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double md = (double)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * pt;
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

bool Retryable(uint rc)
{
   return (rc == TRADE_RETCODE_REQUOTE || rc == TRADE_RETCODE_PRICE_CHANGED ||
           rc == TRADE_RETCODE_PRICE_OFF || rc == TRADE_RETCODE_TOO_MANY_REQUESTS);
}

ulong PosFromResult()
{
   ulong d = g_trade.ResultDeal();
   if(d > 0 && HistoryDealSelect(d)) return (ulong)HistoryDealGetInteger(d, DEAL_POSITION_ID);
   return g_trade.ResultOrder();
}

bool CmdIsStale(SlaveCmd &c, string &why)
{
   if(InpMaxCmdAgeSec <= 0 || c.created <= 0) return false;
   long age = (long)TimeGMT() - c.created;
   if(age > InpMaxCmdAgeSec) { why = StringFormat("stale command (%d s old)", age); return true; }
   return false;
}

//+------------------------------------------------------------------+
//| Actions                                                           |
//+------------------------------------------------------------------+
// If we had a pending copy for this master ticket: cancel it if still pending,
// or adopt it if it already filled. Returns true when adopted (nothing to open).
bool ResolvePendingForOpen(ulong mt, ulong &posTicket)
{
   string k = GVOrd(mt);
   if(!GlobalVariableCheck(k)) return false;
   ulong o = (ulong)GlobalVariableGet(k);
   GlobalVariableDel(k);
   if(OrderSelect(o)) { g_trade.OrderDelete(o); return false; }
   if(PositionSelectByTicket(o))
   {
      posTicket = o;
      GlobalVariableSet(GVPos(mt), (double)o);
      return true;
   }
   return false;
}

void DoOpen(SlaveCmd &c, SlaveRes &r, bool isAdd)
{
   if(!isAdd)
   {
      ulong ex = FindCopy(c.mticket);
      if(ex > 0) { SetRes(r, "skipped", "already copied"); r.ticket = ex; return; }
      ulong adopted = 0;
      if(ResolvePendingForOpen(c.mticket, adopted))
      { SetRes(r, "executed", "adopted filled pending order"); r.ticket = adopted; return; }
   }

   string why;
   if(!CanOpen(why))        { SetRes(r, "skipped", why); return; }
   if(CmdIsStale(c, why))   { SetRes(r, "skipped", why); return; }

   string sym = ResolveSymbol(c.symbol, c.suffix);
   if(sym == "")            { SetRes(r, "failed", "symbol not found: " + c.symbol); return; }
   if(c.side != "buy" && c.side != "sell") { SetRes(r, "failed", "bad side " + c.side); return; }

   bool mBuy  = (c.side == "buy");
   bool isBuy = c.reverse ? !mBuy : mBuy;
   double pt  = SymbolInfoDouble(sym, SYMBOL_POINT);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
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
   g_trade.SetTypeFillingBySymbol(sym);
   g_trade.SetDeviationInPoints(Dev(c));
   bool ok = false;
   for(int a = 0; a <= InpRetries; a++)
   {
      double px = isBuy ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID);
      ok = isBuy ? g_trade.Buy(vol, sym, px, sl, tp, cm) : g_trade.Sell(vol, sym, px, sl, tp, cm);
      if(ok && CP_TradeDone(g_trade.ResultRetcode())) break;
      if(!Retryable(g_trade.ResultRetcode())) break;
      Sleep(150);
   }
   if(!ok || !CP_TradeDone(g_trade.ResultRetcode()))
   { SetRes(r, "failed", StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); return; }

   ulong pos = PosFromResult();
   if(pos > 0 && !GlobalVariableCheck(GVPos(c.mticket))) GlobalVariableSet(GVPos(c.mticket), (double)pos);
   r.status = "executed"; r.ticket = pos; r.volume = g_trade.ResultVolume(); r.price = g_trade.ResultPrice();
}

void DoClose(SlaveCmd &c, SlaveRes &r)   // always allowed, even under kill/pause/halt
{
   ulong t = FindCopy(c.mticket);
   if(t == 0 || !PositionSelectByTicket(t)) { SetRes(r, "skipped", "no open copy (already closed?)"); return; }
   double vol = PositionGetDouble(POSITION_VOLUME);
   g_trade.SetTypeFillingBySymbol(PositionGetString(POSITION_SYMBOL));
   bool ok = false;
   for(int a = 0; a <= InpRetries; a++)
   {
      ok = g_trade.PositionClose(t, Dev(c));
      if(ok && CP_TradeFullyDone(g_trade.ResultRetcode())) break;
      if(!Retryable(g_trade.ResultRetcode())) break;
      Sleep(150);
   }
   if(!ok || !CP_TradeFullyDone(g_trade.ResultRetcode()))
   { SetRes(r, "failed", StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); return; }
   GlobalVariableDel(GVPos(c.mticket));
   r.status = "executed"; r.ticket = t; r.volume = vol; r.price = g_trade.ResultPrice();
}

void DoPartial(SlaveCmd &c, SlaveRes &r)
{
   ulong t = FindCopy(c.mticket);
   if(t == 0 || !PositionSelectByTicket(t)) { SetRes(r, "skipped", "no open copy"); return; }
   string sym = PositionGetString(POSITION_SYMBOL);
   double pv = PositionGetDouble(POSITION_VOLUME);
   if(c.ratio <= 0 || c.ratio > 1) { SetRes(r, "failed", "bad close ratio"); return; }

   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP), mn = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   if(step <= 0) step = 0.01;
   double vol = MathRound(pv * c.ratio / step) * step;
   int dg = (int)MathMax(0, MathRound(-MathLog10(step)));
   vol = NormalizeDouble(vol, dg);

   if(vol >= pv - step / 2) { DoClose(c, r); return; }          // effectively everything
   if(vol < mn)             { SetRes(r, "skipped", "partial amount below minimum lot"); return; }

   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = g_trade.PositionClosePartial(t, vol, Dev(c));
   if(!ok || !CP_TradeDone(g_trade.ResultRetcode()))
   { SetRes(r, "failed", StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); return; }
   r.status = "executed"; r.ticket = t; r.volume = g_trade.ResultVolume(); r.price = g_trade.ResultPrice();
}

void DoModify(SlaveCmd &c, SlaveRes &r)
{
   if(!InpCopySLTP) { SetRes(r, "skipped", "SL/TP copying disabled"); return; }
   ulong t = FindCopy(c.mticket);
   if(t == 0 || !PositionSelectByTicket(t)) { SetRes(r, "skipped", "no open copy"); return; }
   string sym = PositionGetString(POSITION_SYMBOL);
   bool isBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   double sl = c.sl, tp = c.tp;
   if(c.reverse) { double x = sl; sl = tp; tp = x; }
   FixStops(sym, isBuy, isBuy ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK), sl, tp);

   double pt = SymbolInfoDouble(sym, SYMBOL_POINT);
   if(MathAbs(sl - PositionGetDouble(POSITION_SL)) < pt / 2 && MathAbs(tp - PositionGetDouble(POSITION_TP)) < pt / 2)
   { SetRes(r, "skipped", "no change"); r.ticket = t; return; }

   bool ok = g_trade.PositionModify(t, sl, tp);
   if(!ok || !CP_TradeModified(g_trade.ResultRetcode()))
   { SetRes(r, "failed", StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); return; }
   r.status = "executed"; r.ticket = t;
}

void DoPendingPlace(SlaveCmd &c, SlaveRes &r)
{
   if(c.reverse) { SetRes(r, "skipped", "pending orders are not copied in reverse mode"); return; }
   string k = GVOrd(c.mticket);
   if(GlobalVariableCheck(k) && OrderSelect((ulong)GlobalVariableGet(k)))
   { SetRes(r, "skipped", "pending already placed"); return; }

   string why;
   if(!CanOpen(why))      { SetRes(r, "skipped", why); return; }
   if(CmdIsStale(c, why)) { SetRes(r, "skipped", why); return; }

   string sym = ResolveSymbol(c.symbol, c.suffix);
   if(sym == "") { SetRes(r, "failed", "symbol not found: " + c.symbol); return; }

   bool isBuy = (StringFind(c.side, "buy") == 0);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double price = NormalizeDouble(c.price, dg);
   double sl = InpCopySLTP ? c.sl : 0, tp = InpCopySLTP ? c.tp : 0;
   FixStops(sym, isBuy, price, sl, tp);

   double vol = CalcVolume(c, sym, isBuy, price, sl);
   if(vol < 0) { SetRes(r, "skipped", "cannot size lot"); return; }
   vol = NormVol(sym, vol, c.lotMode == "risk_pct");
   if(vol <= 0) { SetRes(r, "skipped", "lot below broker minimum or risk-safe volume unavailable"); return; }

   string cm = Tag(c.mticket);
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = false;
   if(c.side == "buy_limit")       ok = g_trade.BuyLimit(vol, price, sym, sl, tp, ORDER_TIME_GTC, 0, cm);
   else if(c.side == "sell_limit") ok = g_trade.SellLimit(vol, price, sym, sl, tp, ORDER_TIME_GTC, 0, cm);
   else if(c.side == "buy_stop")   ok = g_trade.BuyStop(vol, price, sym, sl, tp, ORDER_TIME_GTC, 0, cm);
   else if(c.side == "sell_stop")  ok = g_trade.SellStop(vol, price, sym, sl, tp, ORDER_TIME_GTC, 0, cm);
   else { SetRes(r, "failed", "unsupported pending type " + c.side); return; }

   if(!ok || !CP_PendingAccepted(g_trade.ResultRetcode()))
   { SetRes(r, "failed", StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); return; }
   ulong o = g_trade.ResultOrder();
   GlobalVariableSet(k, (double)o);
   r.status = "executed"; r.ticket = o; r.volume = vol; r.price = price;
}

void DoPendingModify(SlaveCmd &c, SlaveRes &r)
{
   string k = GVOrd(c.mticket);
   if(!GlobalVariableCheck(k)) { SetRes(r, "skipped", "no pending copy"); return; }
   ulong o = (ulong)GlobalVariableGet(k);
   if(!OrderSelect(o)) { GlobalVariableDel(k); SetRes(r, "skipped", "pending no longer exists"); return; }
   string sym = OrderGetString(ORDER_SYMBOL);
   bool isBuy = (StringFind(c.side, "buy") == 0);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double price = NormalizeDouble(c.price, dg);
   double sl = InpCopySLTP ? c.sl : 0, tp = InpCopySLTP ? c.tp : 0;
   FixStops(sym, isBuy, price, sl, tp);
   bool ok = g_trade.OrderModify(o, price, sl, tp, ORDER_TIME_GTC, 0);
   if(!ok || !CP_TradeModified(g_trade.ResultRetcode()))
   { SetRes(r, "failed", StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); return; }
   r.status = "executed"; r.ticket = o; r.price = price;
}

void DoPendingDelete(SlaveCmd &c, SlaveRes &r)
{
   string k = GVOrd(c.mticket);
   if(!GlobalVariableCheck(k)) { SetRes(r, "skipped", "no pending copy"); return; }
   ulong o = (ulong)GlobalVariableGet(k);
   if(!OrderSelect(o)) { GlobalVariableDel(k); SetRes(r, "skipped", "pending no longer exists"); return; }
   bool ok = g_trade.OrderDelete(o);
   if(!ok || !CP_TradeDeleted(g_trade.ResultRetcode()))
   { SetRes(r, "failed", StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); return; }
   GlobalVariableDel(k);
   r.status = "executed"; r.ticket = o;
}

// Close one position by its raw broker ticket (dashboard "x" button). Always allowed.
void DoCloseTicket(SlaveCmd &c, SlaveRes &r)
{
   if(!PositionSelectByTicket(c.mticket)) { SetRes(r, "skipped", "no open copy (already closed?)"); return; }
   double vol = PositionGetDouble(POSITION_VOLUME);
   g_trade.SetTypeFillingBySymbol(PositionGetString(POSITION_SYMBOL));
   bool ok = false;
   for(int a = 0; a <= InpRetries; a++)
   {
      ok = g_trade.PositionClose(c.mticket, Dev(c));
      if(ok && CP_TradeFullyDone(g_trade.ResultRetcode())) break;
      if(!Retryable(g_trade.ResultRetcode())) break;
      Sleep(150);
   }
   if(!ok || !CP_TradeFullyDone(g_trade.ResultRetcode()))
   { SetRes(r, "failed", StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); return; }
   r.status = "executed"; r.ticket = c.mticket; r.volume = vol; r.price = g_trade.ResultPrice();
}

// anyMagic=false closes only copier trades (used by the daily-loss guard);
// anyMagic=true closes every position on the account (dashboard "close all").
void DoCloseAll(SlaveRes &r, bool anyMagic)
{
   int closed = 0, deleted = 0, failed = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(!anyMagic && PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;

      g_trade.SetTypeFillingBySymbol(PositionGetString(POSITION_SYMBOL));
      bool ok = g_trade.PositionClose(t, InpSlippagePts);

      if(ok && CP_TradeFullyDone(g_trade.ResultRetcode())) closed++;
      else failed++;
   }

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong o = OrderGetTicket(i);
      if(o == 0) continue;
      if(!anyMagic && OrderGetInteger(ORDER_MAGIC) != InpMagic) continue;

      bool ok = g_trade.OrderDelete(o);
      if(ok && CP_TradeDeleted(g_trade.ResultRetcode())) deleted++;
      else failed++;
   }

   r.status = (failed == 0) ? "executed" : "failed";
   r.msg = StringFormat("closed %d, deleted pending %d, failed %d",
                        closed, deleted, failed);
}

//+------------------------------------------------------------------+
//| Daily loss protection (runs locally, works even if server is down)|
//+------------------------------------------------------------------+
int DayKey()
{
   MqlDateTime d;
   TimeToStruct(TimeCurrent(), d);
   return d.year * 10000 + d.mon * 100 + d.day;
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
      g_dayStartEq = AccountInfoDouble(ACCOUNT_EQUITY);
      g_dailyHalt = false;
      GlobalVariableSet(gk, (double)k);
      GlobalVariableSet(gq, g_dayStartEq);
   }
}

void CheckDailyLoss()
{
   if(g_dailyLossPct <= 0 || g_dayStartEq <= 0 || g_dailyHalt) return;
   double dd = (g_dayStartEq - AccountInfoDouble(ACCOUNT_EQUITY)) / g_dayStartEq * 100.0;
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
      ulong mt = (ulong)StringToInteger(StringSubstr(nm, StringLen(pre)));
      ulong st = (ulong)GlobalVariableGet(nm);
      if(!PositionSelectByTicket(st)) { GlobalVariableDel(nm); continue; }   // closed locally
      if(count > 0) s += ",";
      s += "{\"m\":" + (string)mt + ",\"s\":" + (string)st +
           ",\"v\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 8) +
           ",\"p\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + "}";
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
   j += "\"role\":\"slave\",\"platform\":\"mt5\",";
   j += "\"login\":" + (string)g_login + ",";
   j += "\"server\":\"" + CP_Esc(AccountInfoString(ACCOUNT_SERVER)) + "\",";
   j += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   j += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   j += "\"margin_level\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) + ",";
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
   Comment(StringFormat("Copier SLAVE | server: %s | copies: %d | kill:%s pause:%s dailyHalt:%s",
           code == 200 ? "OK" : "ERR " + (string)code, cnt,
           g_kill ? "ON" : "off", g_pause ? "ON" : "off", g_dailyHalt ? "ON" : "off"));
}
