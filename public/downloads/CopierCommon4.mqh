//+------------------------------------------------------------------+
//| CopierCommon4.mqh  (MT4 version)                                   |
//| Shared helpers: HTTP to the Rails server + durable-ish outbox     |
//| + MT4 trade helpers (OrderSend / OrderClose / OrderModify).        |
//| Place in the same folder as the EAs (MQL4/Experts)                |
//+------------------------------------------------------------------+
#property strict

string   g_cpUrl      = "";
string   g_cpToken    = "";
int      g_cpTimeout  = 3000;
bool     g_cpDebug    = false;
ulong    g_cpLastOkMs = 0;

struct CPOutItem { string path; string body; };
CPOutItem g_out[];
ulong     g_outNextTry   = 0;
int       g_outBackoff   = 500;
bool      g_authAlerted  = false;

void CP_Log(string m) { Print("[Copier] ", m); }
void CP_Dbg(string m) { if(g_cpDebug) Print("[Copier:dbg] ", m); }

// MQL4 only has the 32-bit GetTickCount(); this makes it a wrap-safe 64-bit millisecond clock.
ulong CP_NowMs()
{
   static uint  last = 0;
   static ulong hi   = 0;
   uint t = GetTickCount();
   if(t < last) hi += 4294967296;
   last = t;
   return hi + t;
}

void CP_Init(string url, string token, int timeoutMs, bool debug)
{
   g_cpUrl = url;
   while(StringLen(g_cpUrl) > 0 && StringSubstr(g_cpUrl, StringLen(g_cpUrl) - 1, 1) == "/")
      g_cpUrl = StringSubstr(g_cpUrl, 0, StringLen(g_cpUrl) - 1);
   g_cpToken   = token;
   g_cpTimeout = timeoutMs;
   g_cpDebug   = debug;
   g_cpLastOkMs = CP_NowMs();
}

string CP_Esc(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\r", " ");
   return s;
}

// Returns HTTP status code, or -1 when the request itself failed.
int CP_Http(string method, string path, string body, string &resp)
{
   char   data[];
   char   result[];
   string rh;
   resp = "";

   if(StringLen(body) > 0)
   {
      int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
      if(n > 0) ArrayResize(data, n - 1);   // drop terminating zero
   }

   string headers = "Content-Type: application/json\r\n"
                    "Accept: text/plain, application/json\r\n"
                    "X-Account-Token: " + g_cpToken + "\r\n";

   ResetLastError();
   int code = WebRequest(method, g_cpUrl + path, headers, g_cpTimeout, data, result, rh);
   if(code == -1)
   {
      int e = GetLastError();
      CP_Log(StringFormat("WebRequest failed (err %d). If 4060, add %s under Tools > Options > Expert Advisors > Allow WebRequest for listed URL.", e, g_cpUrl));
      return -1;
   }
   resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code >= 200 && code < 300) g_cpLastOkMs = CP_NowMs();
   return code;
}

//+------------------------------------------------------------------+
//| MT4 order-pool helpers                                            |
//| In MT4 positions and pending orders live in one pool (MODE_TRADES)|
//| OP_BUY / OP_SELL = open position, anything else = pending order.  |
//| NOTE: OrderSelect() keeps global state - never nest selections.   |
//+------------------------------------------------------------------+
bool CP_IsPos(int t)
{
   if(t <= 0) return false;
   if(!OrderSelect(t, SELECT_BY_TICKET)) return false;
   if(OrderCloseTime() != 0) return false;
   return (OrderType() == OP_BUY || OrderType() == OP_SELL);
}

bool CP_IsPending(int t)
{
   if(t <= 0) return false;
   if(!OrderSelect(t, SELECT_BY_TICKET)) return false;
   if(OrderCloseTime() != 0) return false;
   return (OrderType() > OP_SELL);
}

// Every open position on the account, as a JSON array (for the dashboard).
// t=ticket s=symbol d=side v=volume o=open price p=current price pr=profit+swap at=open time (GMT epoch)
string CP_PositionsJson(int maxItems = 100)
{
   string s = "";
   int n = 0;
   long off = (long)(TimeCurrent() - TimeGMT());
   int total = OrdersTotal();
   for(int i = 0; i < total && n < maxItems; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int ty = OrderType();
      if(ty != OP_BUY && ty != OP_SELL) continue;
      if(n > 0) s += ",";
      s += "{\"t\":" + (string)OrderTicket();
      s += ",\"s\":\"" + CP_Esc(OrderSymbol()) + "\"";
      s += ",\"d\":\"" + (ty == OP_BUY ? "buy" : "sell") + "\"";
      s += ",\"v\":" + DoubleToString(OrderLots(), 8);
      s += ",\"o\":" + DoubleToString(OrderOpenPrice(), 8);
      s += ",\"p\":" + DoubleToString(OrderClosePrice(), 8);
      s += ",\"sl\":" + DoubleToString(OrderStopLoss(), 8);
      s += ",\"tp\":" + DoubleToString(OrderTakeProfit(), 8);
      s += ",\"pr\":" + DoubleToString(OrderProfit() + OrderSwap(), 2);
      s += ",\"at\":" + (string)((long)OrderOpenTime() - off) + "}";
      n++;
   }
   return "[" + s + "]";
}

// One "SYMBOL":price fragment for the quotes object; "" when there is no price.
string CP_QuoteItem(string base, string sym)
{
   if(sym == "") return "";
   double bid = MarketInfo(sym, MODE_BID);
   if(bid <= 0) return "";
   return "\"" + CP_Esc(base) + "\":" + DoubleToString(bid, 8);
}

// Finds the broker's name for a base symbol: prefix+base+suffix, then base, then a fuzzy match.
string CP_FindSymbol(string base, string prefix, string suffix)
{
   string c1 = prefix + base + suffix;
   if(SymbolSelect(c1, true)) return c1;
   if(SymbolSelect(base, true)) return base;
   string b6 = (StringLen(base) > 6) ? StringSubstr(base, 0, 6) : base;
   int total = SymbolsTotal(false), bestLen = 1000;
   string found = "";
   for(int i = 0; i < total; i++)
   {
      string nm = SymbolName(i, false);
      if(StringFind(nm, b6) < 0) continue;
      if(SymbolInfoInteger(nm, SYMBOL_TRADE_MODE) == SYMBOL_TRADE_MODE_DISABLED) continue;
      if(StringLen(nm) < bestLen) { bestLen = StringLen(nm); found = nm; }
   }
   if(found != "") SymbolSelect(found, true);
   return found;
}

int CP_Lines(string text, string &lines[])
{
   StringReplace(text, "\r", "");
   return StringSplit(text, '\n', lines);
}

//--- Outbox: events/acks are queued and retried with backoff so a
//--- network blip never loses a trade event. Server dedupes by idempotency key.
void CP_Enqueue(string path, string body)
{
   int n = ArraySize(g_out);
   if(n >= 5000)
   {
      for(int i = 1; i < n; i++) g_out[i - 1] = g_out[i];
      n--;
      ArrayResize(g_out, n);
      CP_Log("Outbox full: dropped oldest item");
   }
   ArrayResize(g_out, n + 1);
   g_out[n].path = path;
   g_out[n].body = body;
}

void CP_PopFront()
{
   int n = ArraySize(g_out);
   if(n <= 0) return;
   for(int i = 1; i < n; i++) g_out[i - 1] = g_out[i];
   ArrayResize(g_out, n - 1);
}

void CP_FlushOutbox()
{
   if(CP_NowMs() < g_outNextTry) return;

   int guard = 0;
   while(ArraySize(g_out) > 0 && guard < 25)
   {
      guard++;
      string resp;
      int code = CP_Http("POST", g_out[0].path, g_out[0].body, resp);

      if((code >= 200 && code < 300) || code == 409)      // ok or duplicate
      {
         CP_PopFront();
         g_outBackoff = 500;
         continue;
      }
      if(code == 400 || code == 404 || code == 422)       // will never succeed: drop
      {
         CP_Log(StringFormat("Server rejected %s (%d): %s", g_out[0].path, code, resp));
         CP_PopFront();
         continue;
      }
      if(code == 401 || code == 403)
      {
         if(!g_authAlerted) { Alert("Copier: server rejected the account token."); g_authAlerted = true; }
         g_outBackoff = 30000;
      }
      else
         g_outBackoff = MathMin(g_outBackoff * 2, 30000);

      g_outNextTry = CP_NowMs() + g_outBackoff;
      return;
   }
}

//+------------------------------------------------------------------+
//| Persistent command result ledger                                 |
//+------------------------------------------------------------------+
string CP_ResultFile(string role, long login)
{
   return "CopierResults_" + role + "_" + (string)login + ".txt";
}

// Returns 1 = found, 0 = not found, -1 = read error.
int CP_ResultFind(string role, long login, long commandId,
                  string &status, string &message, int &ticket,
                  double &volume, double &price)
{
   string name = CP_ResultFile(role, login);

   if(!FileIsExist(name))
      return 0;

   ResetLastError();
   int h = FileOpen(name, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      CP_Log("Cannot read result ledger: " + name);
      return -1;
   }

   bool found = false;
   while(!FileIsEnding(h))
   {
      string line = FileReadString(h);
      if(StringLen(line) == 0) continue;

      string p[];
      int n = StringSplit(line, '|', p);
      if(n < 6) continue;
      if(StringToInteger(p[0]) != commandId) continue;

      status  = p[1];
      ticket  = (int)StringToInteger(p[2]);
      volume  = StringToDouble(p[3]);
      price   = StringToDouble(p[4]);
      message = p[5];
      found = true;
      break;
   }

   FileClose(h);
   return found ? 1 : 0;
}

bool CP_ResultSave(string role, long login, long commandId,
                   string status, string message, int ticket,
                   double volume, double price)
{
   StringReplace(message, "|", "/");
   StringReplace(message, "\r", " ");
   StringReplace(message, "\n", " ");

   string name = CP_ResultFile(role, login);

   ResetLastError();
   int h = FileOpen(name, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      CP_Log("Cannot write result ledger: " + name);
      return false;
   }

   if(!FileSeek(h, 0, SEEK_END))
   {
      CP_Log("Cannot seek result ledger: " + name);
      FileClose(h);
      return false;
   }

   string line = (string)commandId + "|" + status + "|" + (string)ticket + "|" +
                 DoubleToString(volume, 8) + "|" + DoubleToString(price, 8) + "|" +
                 message + "\r\n";

   uint written = FileWriteString(h, line);
   FileFlush(h);
   FileClose(h);

   if(written != (uint)StringLen(line))
   {
      CP_Log("Incomplete result ledger write: " + name +
             " (wrote " + (string)written + " of " + (string)StringLen(line) + " characters)");
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| MT4 trade helpers. Every function returns true on success and      |
//| puts the MT4 error code in 'err' on failure.                       |
//+------------------------------------------------------------------+
string CP_Err(int e)
{
   string d;
   switch(e)
   {
      case 1:   d = "no change / no result";           break;
      case 2:   d = "common error";                    break;
      case 3:   d = "invalid trade parameters";        break;
      case 4:   d = "trade server busy";               break;
      case 6:   d = "no connection with trade server"; break;
      case 8:   d = "too frequent requests";           break;
      case 64:  d = "account disabled";                break;
      case 65:  d = "invalid account";                 break;
      case 128: d = "trade timeout";                   break;
      case 129: d = "invalid price";                   break;
      case 130: d = "invalid stops";                   break;
      case 131: d = "invalid trade volume";            break;
      case 132: d = "market is closed";                break;
      case 133: d = "trade is disabled";               break;
      case 134: d = "not enough money";                break;
      case 135: d = "price changed";                   break;
      case 136: d = "off quotes";                      break;
      case 137: d = "broker is busy";                  break;
      case 138: d = "requote";                         break;
      case 139: d = "order is locked";                 break;
      case 140: d = "buy orders only allowed";         break;
      case 141: d = "too many requests";               break;
      case 145: d = "modification denied (too close to market)"; break;
      case 146: d = "trade context busy";              break;
      case 147: d = "expiration denied by broker";     break;
      case 148: d = "too many open/pending orders";    break;
      case 149: d = "hedging prohibited";              break;
      case 150: d = "prohibited by FIFO rule";         break;
      case 4108: d = "invalid ticket";                 break;
      default:  d = "error";                           break;
   }
   return StringFormat("%d %s", e, d);
}

// Errors worth retrying with a fresh price. (Timeout 128 is NOT retried: the order may exist.)
bool CP_Retryable(int e)
{
   return (e == 138 || e == 135 || e == 136 || e == 137 ||
           e == 4   || e == 141 || e == 146 || e == 8);
}

// Market order. retries = extra attempts after the first.
bool CP_SendMarket(string sym, bool isBuy, double vol, double sl, double tp,
                   string cm, int magic, int slip, int retries,
                   int &ticket, double &price, int &err)
{
   ticket = 0; price = 0; err = 0;
   int dg = (int)MarketInfo(sym, MODE_DIGITS);

   for(int a = 0; a <= retries; a++)
   {
      RefreshRates();
      double px = NormalizeDouble(MarketInfo(sym, isBuy ? MODE_ASK : MODE_BID), dg);
      ResetLastError();
      int t = OrderSend(sym, isBuy ? OP_BUY : OP_SELL, vol, px, slip, sl, tp, cm, magic, 0, clrNONE);
      if(t > 0)
      {
         ticket = t;
         price  = px;
         if(OrderSelect(t, SELECT_BY_TICKET)) price = OrderOpenPrice();
         err = 0;
         return true;
      }
      err = GetLastError();
      if(!CP_Retryable(err)) break;
      Sleep(150);
   }
   return false;
}

// Pending order: type is OP_BUYLIMIT / OP_SELLLIMIT / OP_BUYSTOP / OP_SELLSTOP.
bool CP_SendPending(string sym, int type, double vol, double price, double sl, double tp,
                    string cm, int magic, int &ticket, int &err)
{
   ticket = 0; err = 0;
   ResetLastError();
   int t = OrderSend(sym, type, vol, price, 0, sl, tp, cm, magic, 0, clrNONE);
   if(t > 0) { ticket = t; return true; }
   err = GetLastError();
   return false;
}

// Close (or partially close) an open position. lots = OrderLots() for a full close.
// NOTE: a partial close in MT4 gives the remainder a NEW ticket, comment "from #<old ticket>".
bool CP_CloseOrder(int t, double lots, int slip, int retries, double &price, int &err)
{
   price = 0; err = 0;
   if(!CP_IsPos(t)) { err = 4108; return false; }
   string sym = OrderSymbol();
   int    ty  = OrderType();
   int    dg  = (int)MarketInfo(sym, MODE_DIGITS);

   for(int a = 0; a <= retries; a++)
   {
      RefreshRates();
      double px = NormalizeDouble(MarketInfo(sym, ty == OP_BUY ? MODE_BID : MODE_ASK), dg);
      ResetLastError();
      if(OrderClose(t, lots, px, slip, clrNONE))
      {
         price = px;
         if(OrderSelect(t, SELECT_BY_TICKET)) price = OrderClosePrice();
         err = 0;
         return true;
      }
      err = GetLastError();
      if(!CP_Retryable(err)) break;
      Sleep(150);
   }
   return false;
}

// Modify SL/TP of a position, or price/SL/TP of a pending order.
// "No change" (error 1) counts as success.
bool CP_ModifyOrder(int t, double newPrice, double sl, double tp, int &err)
{
   err = 0;
   if(!OrderSelect(t, SELECT_BY_TICKET) || OrderCloseTime() != 0) { err = 4108; return false; }
   int dg = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
   double pr = (OrderType() <= OP_SELL) ? OrderOpenPrice() : NormalizeDouble(newPrice, dg);
   sl = NormalizeDouble(sl, dg);
   tp = NormalizeDouble(tp, dg);

   ResetLastError();
   if(OrderModify(t, pr, sl, tp, 0, clrNONE)) return true;
   err = GetLastError();
   if(err == 1) { err = 0; return true; }
   return false;
}

bool CP_DeleteOrder(int t, int &err)
{
   err = 0;
   ResetLastError();
   if(OrderDelete(t, clrNONE)) return true;
   err = GetLastError();
   return false;
}

// Ticket of the remainder after a partial close of 'oldTicket' (comment "from #oldTicket"); 0 if none.
int CP_FindRemainder(int oldTicket, int magic, bool anyMagic)
{
   string want = "from #" + (string)oldTicket;
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() > OP_SELL) continue;
      if(!anyMagic && OrderMagicNumber() != magic) continue;
      if(OrderComment() == want) return OrderTicket();
   }
   return 0;
}
//+------------------------------------------------------------------+
