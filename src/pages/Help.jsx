import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpen, CheckCircle2, Download, FileCode2, Info, KeyRound, Lightbulb, Package, Plug, ShieldCheck } from 'lucide-react';
import { LOT_MODES } from '../lib/format';
import { apiOrigin } from '../lib/api';
import { CopyButton } from '../components/ui';

// ---------- content ----------
const TOC = [
  ['before', 'Before you begin'],
  ['roles', 'Master and follower'],
  ['download', 'Download the EAs'],
  ['install', 'Install the EAs'],
  ['webrequest', 'Allow WebRequest'],
  ['master', 'Connect the master'],
  ['follower', 'Connect a follower'],
  ['link', 'Link accounts'],
  ['verify', 'Verify it works'],
  ['rules', 'Operating rules'],
  ['inputs', 'EA input reference'],
  ['trouble', 'Troubleshooting'],
  ['support', 'Support'],
  ['checklist', 'Final checklist'],
];

const DOWNLOADS = [
  { file: 'CopierMaster.mq5', title: 'CopierMaster', role: 'Master', size: '23 KB', text: 'Attach to the account you trade on. Reports every trade change to Mirrorline.' },
  { file: 'CopierSlave.mq5', title: 'CopierSlave', role: 'Follower', size: '35 KB', text: 'Attach to every account that copies the master. Executes copied trades within your limits.' },
  { file: 'CopierCommon.mqh', title: 'CopierCommon', role: 'Required', size: '10 KB', text: 'Shared library used by both EAs. Must sit in the same folder as them.' },
];

const MT4_DOWNLOADS = [
  { file: 'CopierMaster.mq4', title: 'CopierMaster MT4', role: 'Master', size: '27 KB', text: 'Attach to the MT4 account where trades originate.' },
  { file: 'CopierSlave.mq4', title: 'CopierSlave MT4', role: 'Follower', size: '36 KB', text: 'Attach to each MT4 account that receives copied trades.' },
  { file: 'CopierCommon4.mqh', title: 'CopierCommon4', role: 'Required', size: '16 KB', text: 'Shared MT4 library required by both MT4 EAs.' },
];

const MT4_INPUTS = [
  ['InpServerUrl', 'Both', 'Your Mirrorline server URL.'],
  ['InpToken', 'Both', 'The unique connection token for this trading account.'],
  ['InpHeartbeatSec', 'Both', 'How often the EA reports that the account is online. Default 5 seconds.'],
  ['InpScanMs', 'Master', 'How often the master scans for trade changes. Default 100 ms.'],
  ['InpOnlyMagic', 'Master', '-1 monitors all magic numbers; another value filters to that magic number.'],
  ['InpSymbols', 'Master', 'Optional comma-separated symbol filter. Empty means all symbols.'],
  ['InpCopyPending', 'Master', 'Whether pending orders are reported.'],
  ['InpSkipCopierTrades', 'Master', 'Ignores trades tagged by the copier to help prevent copying loops.'],
  ['InpAnnounceExisting', 'Master', 'Whether trades already open when the EA starts are announced. Off by default.'],
  ['InpAcceptCommands', 'Master', 'Allows dashboard commands to open or close trades on the master account.'],
  ['InpOrderMagic', 'Master', 'Magic number assigned to trades opened from the dashboard.'],
  ['InpSlippagePts', 'Both', 'Maximum execution slippage in points.'],
  ['InpMaxOrderLot', 'Master', 'Maximum lot size for an order sent from the dashboard. Default 10.'],
  ['InpMaxCmdAgeSec', 'Both', 'Maximum age of an opening command before it is ignored. Default 15 seconds.'],
  ['InpPollMs', 'Follower', 'How often the follower checks for new commands. Default 250 ms.'],
  ['InpMagic', 'Follower', 'Magic number used to identify copied trades. Default 770077.'],
  ['InpMaxDriftPts', 'Follower', 'Skips an opening trade if price drift exceeds this value. 0 disables the limit.'],
  ['InpMaxSpreadPts', 'Follower', 'Skips an opening trade if spread exceeds this value. 0 disables the limit.'],
  ['InpRetries', 'Follower', 'Number of execution retries. Default 3.'],
  ['InpCopySLTP', 'Follower', 'Copies stop loss and take profit. Enabled by default.'],
  ['InpCloseAllAnyMagic', 'Follower', 'Allows dashboard Close All to include manually opened trades.'],
  ['InpMaxLot', 'Follower', 'Maximum lot size. Dashboard Risk settings override the EA defaults.'],
  ['InpRoundUpToMin', 'Follower', 'If enabled, raises undersized trades to broker minimum lot instead of skipping them.'],
  ['InpMaxPositions', 'Follower', 'Maximum number of open positions. Default 30.'],
  ['InpMinMarginLevel', 'Follower', 'Minimum margin level percentage. 0 disables this check.'],
  ['InpUseMarginPct', 'Follower', 'Maximum percentage of free margin one trade may use.'],
  ['InpMaxDailyLossPct', 'Follower', 'Daily loss limit percentage. 0 disables this limit.'],
  ['InpCloseAllOnDailyLoss', 'Follower', 'Closes copier trades when the daily loss limit is reached.'],
  ['InpPrefix / InpSuffix', 'Both', 'Optional broker symbol prefix or suffix.'],
  ['InpSymbolMap', 'Follower', 'Maps broker symbols, for example GOLD=XAUUSD;US30=DJ30.'],
  ['InpQuoteSymbols', 'Both', 'Comma-separated symbols whose prices are displayed on the dashboard.'],
  ['InpDebug', 'Both', 'Enables additional diagnostic logging.'],
];

const CHECKLIST = [
  'Master account added to the dashboard',
  'Follower accounts added to the dashboard',
  'Correct EA attached to each account',
  'Correct server URL entered in every EA',
  'Each EA uses its own account token',
  'Algo Trading enabled in MetaTrader',
  'WebRequest permission configured',
  'Copy links created and active',
  'Accounts showing Online',
  'Copying tested on demo accounts first',
];

const TROUBLE = [
  ['My account shows Offline', (
    <>
      <p>Work through this list, then allow a few seconds for the next heartbeat:</p>
      <ol>
        <li>Is MetaTrader running and logged in to the right account?</li>
        <li>Is the correct EA attached to a chart (smiley face in the chart corner)?</li>
        <li>Is Algo Trading enabled, both on the toolbar and in the EA’s Common tab?</li>
        <li>Are the server URL and token correct, with no extra spaces?</li>
        <li>Is the URL added under Tools → Options → Expert Advisors → Allow WebRequest?</li>
        <li>Can the computer reach the server? The chart comment shows <code>server: ERR …</code> when it cannot.</li>
      </ol>
    </>
  )],
  ['Alert: “set InpServerUrl and InpToken”', <p>Both inputs are empty. Open the EA’s properties (press <code>F7</code> on the chart), choose Inputs and enter the server URL and the account’s token.</p>],
  ['Experts tab: “WebRequest failed (err 4014)”', <p>MetaTrader is blocking the request because the URL is not on the allow-list. Add exactly the server URL shown in the message under Tools → Options → Expert Advisors → Allow WebRequest for listed URL.</p>],
  ['Alert: “server rejected the account token”', <p>The token does not match the account, or it was regenerated. Open Accounts, choose <strong>New token</strong> on that account and paste the new token into the EA’s inputs. The old token stops working immediately.</p>],
  ['The EA runs but trades are not copied', (
    <>
      <p>Open the Overview mirror board. A follower that missed a trade shows the reason beside it. Also check:</p>
      <ul>
        <li>Both accounts are Online and the copy link is switched on.</li>
        <li>The global copy switch in the top bar is not paused.</li>
        <li>The follower has enough free margin and the broker accepts the symbol and lot size.</li>
        <li>The follower’s risk limits on the Risk page are not blocking the trade.</li>
        <li>The Activity page lists every order and its result, including skipped ones.</li>
      </ul>
    </>
  )],
  ['A trade was skipped as “stale command”', <p>The follower EA ignores open commands older than <code>InpMaxCmdAgeSec</code> (15 seconds by default). This protects you from opening an old trade at a bad price after the follower was offline. Trades that were already open on the master are not re-sent when the follower comes back.</p>],
  ['Trades that were already open are not copied', <p>By default the master EA treats trades open at startup as a baseline and does not announce them. Set <code>InpAnnounceExisting</code> to true on the master, or use the Catch-up option on the copy link.</p>],
  ['Skipped: “symbol not found”', <p>The follower’s broker uses a different name, for example <code>XAUUSDm</code> or <code>GOLD</code>. Set a suffix on the copy link, or use <code>InpSuffix</code> / <code>InpSymbolMap</code> on the follower, such as <code>GOLD=XAUUSD</code>.</p>],
  ['Skipped: “trading not allowed (terminal/account/EA)”', <p>Algo Trading is off in the terminal, in the EA’s Common tab, or the broker has disabled automated trading on that account. Enable Algo Trading and check the account’s permissions with your broker.</p>],
  ['The account went offline after restarting my computer', <p>Start MetaTrader and confirm the EA is still attached. If it is not, drag it onto a chart again and re-check its inputs. For uninterrupted copying, run MetaTrader on a Windows VPS.</p>],
];

const RULES = [
  [Plug, 'Keep MetaTrader running', 'Closing the terminal, shutting down the computer or losing internet interrupts copying. A Windows VPS is recommended.'],
  [KeyRound, 'Use the right token on the right account', 'Each EA must run in the terminal logged in to the account that owns its token.'],
  [ShieldCheck, 'Never share tokens', 'If a token may have leaked, use New token on the account and update the EA.'],
  [BookOpen, 'One EA per role per account', 'Do not attach several copies of the same EA to one account unless support tells you to.'],
];

const INPUTS = [
  ['InpServerUrl', 'Both', 'Your Mirrorline server URL (required).'],
  ['InpToken', 'Both', 'The account’s connection token (required).'],
  ['InpHeartbeatSec', 'Both', 'How often the account reports in. Default 5 seconds.'],
  ['InpPrefix / InpSuffix', 'Both', 'Broker symbol prefix or suffix, for example <code>.m</code>.'],
  ['InpQuoteSymbols', 'Both', 'Symbols whose prices appear on the dashboard’s order ticket.'],
  ['InpAnnounceExisting', 'Master', 'Report trades already open at startup. Off by default.'],
  ['InpOnlyMagic / InpSymbols', 'Master', 'Limit what the master reports to one magic number or symbol list.'],
  ['InpCopyPending', 'Master', 'Also report pending orders. On by default.'],
  ['InpAcceptCommands', 'Master', 'Let the dashboard open and close trades on the master.'],
  ['InpMaxOrderLot', 'Master', 'Safety cap for orders placed from the dashboard. Default 10 lots.'],
  ['InpSlippagePts', 'Both', 'Default slippage in points. A copy link can override it.'],
  ['InpMaxCmdAgeSec', 'Both', 'Ignore open commands older than this. Default 15 seconds.'],
  ['InpMaxDriftPts', 'Follower', 'Skip an open if price moved more than this vs the master. 0 is off.'],
  ['InpMaxSpreadPts', 'Follower', 'Skip an open when the spread is wider. The Risk page value replaces it.'],
  ['InpCopySLTP', 'Follower', 'Copy stop loss and take profit. On by default.'],
  ['InpRoundUpToMin', 'Follower', 'Use the minimum lot when the sized lot is too small. Off means skip.'],
  ['InpSymbolMap', 'Follower', 'Explicit symbol map, for example <code>GOLD=XAUUSD;US30=DJ30</code>.'],
  ['InpMagic', 'Follower', 'Magic number used to tag copied trades. Default 770077.'],
  ['InpCloseAllAnyMagic', 'Follower', 'Dashboard “Close all” also closes trades you opened by hand.'],
  ['InpCloseAllOnDailyLoss', 'Follower', 'Close copier trades when the daily loss limit is hit.'],
];

// ---------- small pieces ----------
function Callout({ tone = 'note', title, children }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'tip' ? Lightbulb : Info;
  return (
    <aside className={`callout callout-${tone}`}>
      <Icon size={18} className="callout-ico" />
      <div>{title && <strong>{title}</strong>}<div className="callout-body">{children}</div></div>
    </aside>
  );
}

function Steps({ items }) {
  return (
    <ol className="tl">
      {items.map(([title, body], i) => (
        <li key={title}>
          <span className="tl-n num">{i + 1}</span>
          <div className="tl-body"><h4>{title}</h4><div className="tl-text">{body}</div></div>
        </li>
      ))}
    </ol>
  );
}

function Section({ id, n, title, intro, children }) {
  return (
    <section id={id} className="doc-sec">
      <header className="doc-sec-head"><span className="doc-n num">{String(n).padStart(2, '0')}</span><h2>{title}</h2></header>
      {intro && <p className="doc-intro">{intro}</p>}
      {children}
    </section>
  );
}

const readChecks = () => { try { return JSON.parse(localStorage.getItem('mirrorline.checklist') ?? '[]'); } catch { return []; } };

export default function Help() {
  const server = apiOrigin();
  const [active, setActive] = useState('before');
  const [checked, setChecked] = useState(readChecks);

  useEffect(() => {
    const els = TOC.map(([id]) => document.getElementById(id)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id);
    }, { rootMargin: '-90px 0px -65% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const toggle = (i) => setChecked((prev) => {
    const next = prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i];
    try { localStorage.setItem('mirrorline.checklist', JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });

  return (
    <div className="doc">
      <header className="doc-hero">
        <span className="eyebrow">Client guide</span>
        <h1>Install, connect <em>&amp; control</em></h1>
        <p className="lead">Everything you need to attach the Mirrorline Expert Advisors, connect your accounts and start copying safely.</p>
        <div className="doc-quick">
          <a href="#install"><Download size={18} /><strong>1. Install</strong><span>Put the EAs in MetaTrader</span></a>
          <a href="#master"><Plug size={18} /><strong>2. Connect</strong><span>Master, then followers</span></a>
          <a href="#link"><CheckCircle2 size={18} /><strong>3. Copy</strong><span>Link and verify</span></a>
        </div>
        <div className="server-card">
          <div>
            <span className="muted small">Your server URL, for <code>InpServerUrl</code></span>
            <code className="server-url">{server}</code>
          </div>
          <CopyButton text={server} label="Copy URL" />
        </div>
      </header>

      <div className="doc-grid">
        <nav className="doc-toc" aria-label="On this page">
          <span className="toc-title">On this page</span>
          {TOC.map(([id, label], i) => (
            <a key={id} href={`#${id}`} className={active === id ? 'on' : ''}><span className="num">{String(i + 1).padStart(2, '0')}</span>{label}</a>
          ))}
        </nav>

        <div className="doc-main">
          <Section id="before" n={1} title="Before you begin" intro="Make sure you have the following in place.">
            <ul className="ticks">
              <li>An active Mirrorline account and access to this dashboard.</li>
              <li>A MetaTrader 4 or MetaTrader 5 trading account for every master and follower you plan to connect.</li>
              <li>The matching MetaTrader 4 or MetaTrader 5 terminal installed on your computer or VPS.</li>
              <li>The three files for your platform from the <a href="#download">download section</a>. Do not mix MT4 files with MT5 files.</li>
              <li>A stable internet connection.</li>
            </ul>
            <Callout tone="warn" title="Keep the terminal running">Your computer or VPS must stay on, online and running MetaTrader for copying to continue. For uninterrupted operation we recommend a Windows VPS.</Callout>
          </Section>

          <Section id="roles" n={2} title="Master and follower" intro="Mirrorline uses two account roles. The dashboard calls the second one a follower; the EA files call it the slave.">
            <div className="role-grid">
              <div className="role role-master">
                <span className="badge badge-accent">Master</span>
                <h3>Where trades originate</h3>
                <p className="muted">Opening, modifying or closing a trade here is reported to Mirrorline, which sends it to every linked follower.</p>
                <p className="small">Install <strong>CopierMaster</strong></p>
              </div>
              <div className="role">
                <span className="badge">Follower (slave)</span>
                <h3>Where trades are copied</h3>
                <p className="muted">Receives commands from its linked master and executes them, sized and protected by its own rules and limits.</p>
                <p className="small">Install <strong>CopierSlave</strong> on each one</p>
              </div>
            </div>
            <Callout title="Don’t mix them up">Never install the master EA on a follower account or the follower EA on a master. Several followers can be linked to one master.</Callout>
          </Section>

          <Section id="download" n={3} title="Download the Expert Advisors" intro="Choose the package that matches the platform selected for your trading account.">
            <h3>MetaTrader 5 (MT5)</h3>
            <div className="dl-grid">
              {DOWNLOADS.map((d) => (
                <a key={d.file} className="dl" href={`/downloads/${d.file}`} download>
                  <span className="dl-ico"><FileCode2 size={20} /></span>
                  <span className="dl-body">
                    <strong>{d.title}</strong>
                    <span className="muted small">{d.text}</span>
                    <span className="tags"><span className={`badge ${d.role === 'Master' ? 'badge-accent' : ''}`}>{d.role}</span><code>{d.file}</code><span className="muted small">{d.size}</span></span>
                  </span>
                  <span className="dl-go"><Download size={18} /></span>
                </a>
              ))}
            </div>
            <a className="dl dl-all" href="/downloads/Mirrorline-EAs.zip" download>
              <span className="dl-ico"><Package size={20} /></span>
              <span className="dl-body"><strong>Download MT5 package (.zip)</strong><span className="muted small">Contains CopierMaster.mq5, CopierSlave.mq5 and CopierCommon.mqh.</span></span>
              <span className="dl-go"><Download size={18} /></span>
            </a>

            <h3>MetaTrader 4 (MT4)</h3>
            <div className="dl-grid">
              {MT4_DOWNLOADS.map((d) => (
                <a key={d.file} className="dl" href={`/downloads/${d.file}`} download>
                  <span className="dl-ico"><FileCode2 size={20} /></span>
                  <span className="dl-body">
                    <strong>{d.title}</strong>
                    <span className="muted small">{d.text}</span>
                    <span className="tags"><span className={`badge ${d.role === 'Master' ? 'badge-accent' : ''}`}>{d.role}</span><code>{d.file}</code><span className="muted small">{d.size}</span></span>
                  </span>
                  <span className="dl-go"><Download size={18} /></span>
                </a>
              ))}
            </div>
            <a className="dl dl-all" href="/downloads/Mirrorline-MT4-EAs.zip" download>
              <span className="dl-ico"><Package size={20} /></span>
              <span className="dl-body"><strong>Download MT4 package (.zip)</strong><span className="muted small">Contains CopierMaster.mq4, CopierSlave.mq4 and CopierCommon4.mqh. Keep all three files together.</span></span>
              <span className="dl-go"><Download size={18} /></span>
            </a>
            <Callout tone="warn" title="Do not mix platform files">MT4 uses .mq4 and .mqh files in MQL4. MT5 uses .mq5 and .mqh files in MQL5. Download and install only the package matching your account's platform.</Callout>
            <Callout tone="note" title="Source files need compiling">These downloads contain source code. Compile the master and follower files in MetaEditor before attaching them. The shared .mqh file is required and must remain alongside the EA source files.</Callout>
          </Section>

          <Section id="install" n={4} title="Install and compile the EAs" intro="Follow the instructions for the platform you selected when adding the trading account. Repeat on every separate trading terminal.">
            <h3>MetaTrader 4 installation</h3>
            <Steps items={[
              ['Open MT4 and log in', <p>Start MetaTrader 4 and log in to the exact broker account you want to connect. Confirm the account is connected and prices are updating.</p>],
              ['Open the MT4 Data Folder', <p>In MT4 choose <strong>File → Open Data Folder</strong>. Open <code>MQL4</code>, then <code>Experts</code>. This is the MT4 Expert Advisors folder.</p>],
              ['Copy all three MT4 files', <p>Copy <code>CopierMaster.mq4</code>, <code>CopierSlave.mq4</code> and <code>CopierCommon4.mqh</code> into the same <code>MQL4/Experts</code> folder. Do not rename the shared include file.</p>],
              ['Compile both EAs', <p>Press <code>F4</code> to open MetaEditor. Open <code>CopierMaster.mq4</code> and press <code>F7</code>. Then open <code>CopierSlave.mq4</code> and press <code>F7</code>. Check the Errors tab: both should compile with <strong>0 errors</strong>. Fix compilation errors before continuing.</p>],
              ['Refresh the MT4 Navigator', <p>Return to MT4, press <code>Ctrl + N</code>, right-click <strong>Expert Advisors</strong> and select <strong>Refresh</strong>. You should see CopierMaster and CopierSlave.</p>],
            ]} />
            <Callout tone="tip" title="MT4 file location matters">The three MT4 files must be together in the same terminal's <code>MQL4/Experts</code> folder. Do not put them in <code>MQL5</code> or the Indicators folder.</Callout>

            <h3>MetaTrader 5 installation</h3>
            <Steps items={[
              ['Open MT5 and log in', <p>Start MetaTrader 5 and log in to the account you want to connect.</p>],
              ['Open the MT5 Data Folder', <p>Choose <strong>File → Open Data Folder</strong>, then open <code>MQL5</code> and <code>Experts</code>.</p>],
              ['Copy the MT5 files', <p>Copy <code>CopierMaster.mq5</code>, <code>CopierSlave.mq5</code> and <code>CopierCommon.mqh</code> into the same <code>MQL5/Experts</code> folder.</p>],
              ['Compile both EAs', <p>Press <code>F4</code> to open MetaEditor. Open each <code>.mq5</code> file and press <code>F7</code>. Confirm that both compile with 0 errors.</p>],
              ['Refresh the Navigator', <p>Return to MT5, press <code>Ctrl + N</code>, right-click <strong>Expert Advisors</strong> and choose <strong>Refresh</strong>.</p>],
            ]} />
            <Callout tone="warn" title="Use the correct terminal">MT4 EAs cannot run in MT5, and MT5 EAs cannot run in MT4. Each terminal has its own Data Folder and its own MetaEditor.</Callout>
          </Section>

          <Section id="webrequest" n={5} title="Allow WebRequest" intro="The EAs talk to Mirrorline through MetaTrader’s WebRequest, so this permission is required on every terminal.">
            <Steps items={[
              ['Open the options', <p>Choose <strong>Tools → Options</strong> and open the <strong>Expert Advisors</strong> tab.</p>],
              ['Enable the list', <p>Tick <strong>Allow WebRequest for listed URL</strong>.</p>],
              ['Add the server URL', <p>Add the exact server URL below, then press OK. Only authorise the official Mirrorline address.</p>],
            ]} />
            <div className="server-card slim"><code className="server-url">{server}</code><CopyButton text={server} label="Copy URL" /></div>
            <Callout tone="warn" title="Use the real server address">Do not use <code>localhost</code> or <code>127.0.0.1</code> unless you are running a local development install.</Callout>
          </Section>

          <Section id="master" n={6} title="Connect the master account">
            <Steps items={[
              ['Add the account in the dashboard', <p>Open <Link to="/accounts">Accounts</Link>, choose <strong>Connect account</strong>, enter the details, set the role to <strong>Master</strong> and save. A connection token is shown <strong>once</strong>. Copy it now and keep it private.</p>],
              ['Attach CopierMaster', <p>In MetaTrader, logged in to the master account, open any chart. In the Navigator drag <code>CopierMaster</code> onto it.</p>],
              ['Enter the inputs', (
                <>
                  <p>On the <strong>Inputs</strong> tab set:</p>
                  <table className="doc-table"><tbody>
                    <tr><td><code>InpServerUrl</code></td><td>Your Mirrorline server URL</td></tr>
                    <tr><td><code>InpToken</code></td><td>The master account’s token</td></tr>
                  </tbody></table>
                </>
              )],
              ['Enable Algo Trading', <p>On the <strong>Common</strong> tab tick <strong>Allow Algo Trading</strong> and press OK. Then make sure the <strong>Algo Trading</strong> button on the main toolbar is green.</p>],
              ['Confirm it started', <p>Press <code>Ctrl + T</code> and open the <strong>Experts</strong> tab. You should see <code>[Copier] Master started on account …</code> and the chart shows <code>Copier MASTER | server: OK</code>.</p>],
            ]} />
          </Section>

          <Section id="follower" n={7} title="Connect a follower account" intro="Repeat for every follower. Each one has its own token.">
            <Steps items={[
              ['Add the follower in the dashboard', <p>On <Link to="/accounts">Accounts</Link> choose <strong>Connect account</strong>, set the role to <strong>Follower</strong> and save. Copy the token for this account.</p>],
              ['Attach CopierSlave', <p>In MetaTrader, logged in to the follower account, open a chart and drag <code>CopierSlave</code> onto it.</p>],
              ['Enter the inputs', (
                <>
                  <table className="doc-table"><tbody>
                    <tr><td><code>InpServerUrl</code></td><td>Your Mirrorline server URL</td></tr>
                    <tr><td><code>InpToken</code></td><td>This follower account’s token</td></tr>
                  </tbody></table>
                  <p className="small muted">Tick <strong>Allow Algo Trading</strong> on the Common tab and press OK.</p>
                </>
              )],
              ['Confirm it started', <p>The Experts tab shows <code>[Copier] Slave started on account …</code> and the chart shows <code>Copier SLAVE | server: OK</code>.</p>],
            ]} />
            <Callout tone="tip" title="Risk limits come from the dashboard">The five limits on the <Link to="/risk">Risk</Link> page are sent to each follower’s EA within seconds and replace the EA’s own risk inputs.</Callout>
          </Section>

          <Section id="link" n={8} title="Link master and follower" intro="A copy link tells a follower how to copy the master.">
            <Steps items={[
              ['Create the link', <p>Open <Link to="/links">Copy links</Link>, choose <strong>New link</strong>, pick the master and the follower.</p>],
              ['Choose how to size trades', <p>Pick a lot mode and value. Options are in the table below.</p>],
              ['Set the rules', <p>Optionally reverse direction, cap slippage, set a symbol suffix, filter symbols, copy pending orders or catch up on open trades.</p>],
              ['Save and switch it on', <p>Review the settings before activating. Test on demo accounts first.</p>],
            ]} />
            <div className="mode-grid">
              {Object.entries(LOT_MODES).map(([key, m]) => (
                <div key={key} className="mode"><strong>{m.label}</strong><p className="muted small">{m.hint}</p></div>
              ))}
            </div>
          </Section>

          <Section id="verify" n={9} title="Verify that everything works">
            <div className="table-wrap">
              <table className="doc-table zebra">
                <thead><tr><th>Check</th><th>Expected result</th></tr></thead>
                <tbody>
                  <tr><td>Master EA</td><td>“Master started” in the Experts tab, <code>server: OK</code> on the chart</td></tr>
                  <tr><td>Follower EA</td><td>“Slave started” in the Experts tab, <code>server: OK</code> on the chart</td></tr>
                  <tr><td>Accounts page</td><td>Both accounts show <span className="status"><i className="dot dot-ok" />Online</span></td></tr>
                  <tr><td>Copy link</td><td>Switched on</td></tr>
                  <tr><td>Algo Trading</td><td>Enabled on the toolbar and in each EA</td></tr>
                  <tr><td>WebRequest</td><td>Server URL on the allow-list</td></tr>
                </tbody>
              </table>
            </div>
            <Callout title="Check the dashboard too">A startup message alone does not prove the connection is healthy. The account status on the dashboard is the source of truth.</Callout>
          </Section>

          <Section id="rules" n={10} title="Important operating rules">
            <div className="rule-grid">
              {RULES.map(([Icon, t, d]) => (
                <div key={t} className="rule"><span className="rule-ico"><Icon size={18} /></span><strong>{t}</strong><p className="muted small">{d}</p></div>
              ))}
            </div>
            <Callout tone="note" title="Broker symbol names differ">The same instrument may be <code>XAUUSD</code>, <code>XAUUSDm</code>, <code>XAUUSD.</code> or <code>GOLD</code>. Use a suffix on the copy link, or <code>InpSymbolMap</code> on the follower, to match them.</Callout>
            <Callout tone="warn" title="Understand the risk">Mirrorline copies trades but cannot remove trading risk. Review lot sizing, risk limits, margin and broker execution conditions before copying live.</Callout>
          </Section>

          <Section id="inputs" n={11} title="EA input reference" intro="The settings below are platform-specific. Open the EA properties on its chart, select Inputs, and review the values before running live trades.">
            <div className="table-wrap">
              <table className="doc-table zebra">
                <thead><tr><th>Input</th><th>EA</th><th>What it does</th></tr></thead>
                <tbody>
                  {INPUTS.map(([name, ea, text]) => (
                    <tr key={name}><td><code>{name}</code></td><td><span className={`badge ${ea === 'Master' ? 'badge-accent' : ''}`}>{ea}</span></td><td dangerouslySetInnerHTML={{ __html: text }} /></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>MT4 input reference</h3>
            <div className="table-wrap">
              <table className="doc-table zebra">
                <thead><tr><th>Input</th><th>EA</th><th>What it does</th></tr></thead>
                <tbody>
                  {MT4_INPUTS.map(([name, ea, description]) => (
                    <tr key={name}><td><code>{name}</code></td><td><span className={`badge ${ea === 'Master' ? 'badge-accent' : ''}`}>{ea}</span></td><td>{description}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="trouble" n={12} title="Troubleshooting">
            <div className="faq">
              {TROUBLE.map(([q, a]) => (
                <details key={q}><summary>{q}</summary><div className="faq-a muted">{a}</div></details>
              ))}
            </div>
          </Section>

          <Section id="support" n={13} title="Getting support" intro="If this guide does not solve it, contact Mirrorline Support and include:">
            <ul className="ticks">
              <li>Your Mirrorline account email.</li>
              <li>The affected account name or login, and whether it is a master or follower.</li>
              <li>The error message from MetaTrader’s Experts tab.</li>
              <li>A short description of what happened.</li>
            </ul>
            <Callout tone="warn" title="Never send secrets">Do not send your trading password or an account token to anyone, including support.</Callout>
          </Section>

          <Section id="checklist" n={14} title="Final checklist" intro="Tick these off before trading live. Your ticks are remembered in this browser.">
            <ul className="check">
              {CHECKLIST.map((t, i) => (
                <li key={t}>
                  <label className={checked.includes(i) ? 'done' : ''}>
                    <input type="checkbox" checked={checked.includes(i)} onChange={() => toggle(i)} />
                    <span className="box" aria-hidden="true"><CheckCircle2 size={14} /></span>
                    {t}
                  </label>
                </li>
              ))}
            </ul>
            <div className="doc-sign"><strong className="gold-text">Mirrorline</strong> — Connect. Copy. Control.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
