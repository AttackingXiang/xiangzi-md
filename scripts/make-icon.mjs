import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1024px;height:1024px;background:transparent;overflow:hidden}
  .wrap{width:1024px;height:1024px;display:flex;align-items:center;justify-content:center}
  .squircle{
    width:824px;height:824px;border-radius:190px;
    background:linear-gradient(135deg,#5b6bf5 0%,#8b5cf6 55%,#a855f7 100%);
    box-shadow:0 40px 80px rgba(80,70,200,.35), inset 0 4px 10px rgba(255,255,255,.25);
    display:flex;align-items:center;justify-content:center;position:relative;
    font-family:-apple-system,'SF Pro Display','Helvetica Neue',sans-serif;
  }
  .mark{color:#fff;font-weight:800;font-size:392px;letter-spacing:-26px;
    text-shadow:0 6px 18px rgba(40,30,120,.30);margin-left:-18px}
  .arrow{position:absolute;right:150px;bottom:150px;width:150px;height:150px}
</style></head><body>
  <div class="wrap"><div class="squircle">
    <span class="mark">xz</span>
    <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>
    </svg>
  </div></div>
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {}
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.capturePage()
  const outDir = join(process.cwd(), 'build')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'icon.png'), img.toPNG())
  console.log('icon.png written:', img.getSize())
  app.quit()
})
