import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1024px;height:1024px;background:transparent;overflow:hidden}
  .wrap{width:1024px;height:1024px;display:flex;align-items:center;justify-content:center}
  .squircle{
    width:824px;height:824px;border-radius:190px;
    background:#ffffff;
    box-shadow:0 30px 70px rgba(60,50,120,.18), inset 0 0 0 2px rgba(120,110,180,.10);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:-apple-system,'SF Pro Display','Helvetica Neue',sans-serif;line-height:1;
  }
  .xz{font-weight:700;font-size:168px;letter-spacing:6px;color:#9aa0b3;margin-bottom:18px}
  .md{font-weight:800;font-size:452px;letter-spacing:-14px;
    background:linear-gradient(135deg,#5b6bf5 0%,#8b5cf6 55%,#a855f7 100%);
    -webkit-background-clip:text;background-clip:text;color:transparent}
</style></head><body>
  <div class="wrap"><div class="squircle">
    <span class="xz">xz</span>
    <span class="md">MD</span>
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
