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
              <li>A MetaTrader 5 trading account for every master and follower you plan to connect.</li>
              <li>MetaTrader 5 installed on your computer or VPS.</li>
              <li>The three EA files from the <a href="#download">download section</a> below: <code>CopierMaster</code>, <code>CopierSlave</code> and <code>CopierCommon.mqh</code>.</li>
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

          <Section id="download" n={3} title="Download the Expert Advisors" intro="Download the three files below, or take them all in one zip.">
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
              <span className="dl-body"><strong>Download all three files (.zip)</strong><span className="muted small">CopierMaster.mq5, CopierSlave.mq5 and CopierCommon.mqh in one bundle. Unzip them into the same folder.</span></span>
              <span className="dl-go"><Download size={18} /></span>
            </a>
            <Callout tone="note" title="These are source files">They are MetaTrader 5 source code (<code>.mq5</code>), so they need compiling once in MetaEditor. The install steps below show how. You do not need to edit the code.</Callout>
          </Section>

          <Section id="install" n={4} title="Install the Expert Advisors" intro="Repeat these steps for every MetaTrader 5 terminal you connect.">
            <Steps items={[
              ['Open MetaTrader 5 and log in', <p>Log in to the trading account you want to connect and confirm it is receiving live prices.</p>],
              ['Open the Data Folder', <p>Choose <strong>File → Open Data Folder</strong>, then open <code>MQL5</code> and then <code>Experts</code>. The path ends in <code>MQL5/Experts/</code>.</p>],
              ['Copy the EA files', (
                <>
                  <p>Copy the files into the <code>Experts</code> folder, <strong>all in the same folder</strong>:</p>
                  <ul>
                    <li><code>CopierMaster.mq5</code>, <code>CopierSlave.mq5</code> <strong>and</strong> <code>CopierCommon.mqh</code> from the download section.</li>
                    <li>If you were given compiled <code>.ex5</code> files instead, copy those; <code>CopierCommon.mqh</code> is then not needed.</li>
                  </ul>
                </>
              )],
              ['Compile the EAs', <p>Open MetaEditor (<code>F4</code>), open <code>CopierMaster.mq5</code> and press <code>F7</code>, then do the same for <code>CopierSlave.mq5</code>. The Errors tab should show 0 errors. Skip this step if you were given <code>.ex5</code> files.</p>],
              ['Refresh the Navigator', <p>Back in MetaTrader press <code>Ctrl + N</code>, expand <strong>Expert Advisors</strong>, right-click it and choose <strong>Refresh</strong>. The Copier EAs should now be listed.</p>],
            ]} />
            <Callout tone="tip">If the EAs do not appear, you probably copied them into another terminal’s data folder. Each MetaTrader installation has its own.</Callout>
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

          <Section id="inputs" n={11} title="EA input reference" intro="The settings you are most likely to need. Open them with F7 on the chart, then the Inputs tab.">
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
