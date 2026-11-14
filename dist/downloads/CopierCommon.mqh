//+------------------------------------------------------------------+
//| CopierCommon.mqh                                                  |
//| Shared helpers: HTTP to the Rails server + durable-ish outbox     |
//| Place in the same folder as the EAs (MQL5/Experts)                |
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

void CP_Init(string url, string token, int timeoutMs, bool debug)
{
   g_cpUrl = url;
   while(StringLen(g_cpUrl) > 0 && StringSubstr(g_cpUrl, StringLen(g_cpUrl) - 1, 1) == "/")
      g_cpUrl = StringSubstr(g_cpUrl, 0, StringLen(g_cpUrl) - 1);
   g_cpToken   = token;
   g_cpTimeout = timeoutMs;
   g_cpDebug   = debug;
   g_cpLastOkMs = GetTickCount64();
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
      CP_Log(StringFormat("WebRequest failed (err %d). If 4014, add %s under Tools > Options > Expert Advisors > Allow WebRequest.", e, g_cpUrl));
      return -1;
   }
   resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code >= 200 && code < 300) g_cpLastOkMs = GetTickCount64();
   return code;
}

// Every open position on the account, as a JSON array (for the dashboard).
// t=ticket s=symbol d=side v=volume o=open price p=current price pr=profit+swap at=open time (GMT epoch)
string CP_PositionsJson(int maxItems = 100)
{
   string s = "";
   int n = 0;
   long off = (long)(TimeCurrent() - TimeGMT());
   for(int i = 0; i < PositionsTotal() && n < maxItems; i++)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(n > 0) s += ",";
      s += "{\"t\":" + (string)t;
      s += ",\"s\":\"" + CP_Esc(PositionGetString(POSITION_SYMBOL)) + "\"";
      s += ",\"d\":\"" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "buy" : "sell") + "\"";
      s += ",\"v\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 8);
      s += ",\"o\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 8);
      s += ",\"p\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT), 8);
      s += ",\"sl\":" + DoubleToString(PositionGetDouble(POSITION_SL), 8);
      s += ",\"tp\":" + DoubleToString(PositionGetDouble(POSITION_TP), 8);
      s += ",\"pr\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP), 2);
      s += ",\"at\":" + (string)((long)PositionGetInteger(POSITION_TIME) - off) + "}";
      n++;
   }
   return "[" + s + "]";
}

// One "SYMBOL":price fragment for the quotes object; "" when there is no price.
string CP_QuoteItem(string base, string sym)
{
   if(sym == "") return "";
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
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
   if(GetTickCount64() < g_outNextTry) return;

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

      g_outNextTry = GetTickCount64() + g_outBackoff;
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
int CP_ResultFind(
   string role,
   long login,
   long commandId,
   string &status,
   string &message,
   ulong &ticket,
   double &volume,
   double &price
)
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
      ticket  = (ulong)StringToInteger(p[2]);
      volume  = StringToDouble(p[3]);
      price   = StringToDouble(p[4]);
      message = p[5];

      found = true;
      break;
   }

   FileClose(h);
   return found ? 1 : 0;
}

bool CP_ResultSave(
   string role,
   long login,
   long commandId,
   string status,
   string message,
   ulong ticket,
   double volume,
   double price
)
{
   StringReplace(message, "|", "/");
   StringReplace(message, "\r", " ");
   StringReplace(message, "\n", " ");

   string name = CP_ResultFile(role, login);

   ResetLastError();

   int h = FileOpen(
      name,
      FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI
   );

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

   string line =
      (string)commandId + "|" +
      status + "|" +
      (string)ticket + "|" +
      DoubleToString(volume, 8) + "|" +
      DoubleToString(price, 8) + "|" +
      message + "\r\n";

   uint written = FileWriteString(h, line);
   FileFlush(h);
   FileClose(h);

   if(written != (uint)StringLen(line))
   {
      CP_Log("Incomplete result ledger write: " + name +
             " (wrote " + (string)written +
             " of " + (string)StringLen(line) + " characters)");
      return false;
   }

   return true;
}


// Broker retcode checks. A successful CTrade method call alone is not
// sufficient evidence that the server accepted the requested operation.
bool CP_TradeDone(uint rc)
{
   return rc == TRADE_RETCODE_DONE ||
          rc == TRADE_RETCODE_DONE_PARTIAL;
}

// A full-position close must not be treated as complete after a partial fill.
bool CP_TradeFullyDone(uint rc)
{
   return rc == TRADE_RETCODE_DONE;
}

bool CP_PendingAccepted(uint rc)
{
   return rc == TRADE_RETCODE_PLACED ||
          rc == TRADE_RETCODE_DONE;
}

bool CP_TradeModified(uint rc)
{
   return rc == TRADE_RETCODE_DONE ||
          rc == TRADE_RETCODE_NO_CHANGES;
}

bool CP_TradeDeleted(uint rc)
{
   return rc == TRADE_RETCODE_DONE;
}
