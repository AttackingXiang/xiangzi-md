import {
  BookOpen,
  Bug,
  ChevronRight,
  ExternalLink,
  HeartHandshake,
  PenLine,
  RefreshCw,
  ScrollText,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { desktop } from '../../platform'
import type { UpdaterController } from '../../hooks/useUpdater'
import licenseText from '../../../LICENSE?raw'
import alipaySupportQr from '../../assets/support/alipay-support.jpg'
import paypalSupportQr from '../../assets/support/paypal-support.png'
import wechatSupportQr from '../../assets/support/wechat-support.jpg'
import { SettingsPage, SettingsCard } from './primitives'
import { updateStatusText } from './updateStatusText'

const PROJECT_URL = 'https://github.com/AttackingXiang/xiangzi-md'
const PAYPAL_SUPPORT_URL = 'https://www.paypal.com/ncp/payment/Q3YKYE86YKBPJ'
const ABOUT_LINKS = {
  guide: `${PROJECT_URL}/blob/main/docs/USER_GUIDE.md`,
  releases: `${PROJECT_URL}/releases`,
  feedback: `${PROJECT_URL}/issues/new/choose`,
  privacy: `${PROJECT_URL}/blob/main/PRIVACY.md`,
  project: PROJECT_URL,
} as const

interface Props {
  appVersion: string
  updater: UpdaterController
  en: boolean
}

export default function AboutSection({ appVersion, updater, en }: Props): JSX.Element {
  const [licenseOpen, setLicenseOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)

  return (
    <>
      <SettingsPage title={en ? 'About Xiangzi MD' : '关于 Xiangzi MD'}>
        <div className="about-card">
          <div className="about-logo" aria-hidden="true">
            <PenLine size={24} />
          </div>
          <div>
            <h2>Xiangzi MD</h2>
            <p>v{appVersion}</p>
          </div>
        </div>
        <SettingsCard>
          <p className="about-description">
            {en
              ? 'A local-first WYSIWYG Markdown editor. Your files stay on your device, with no account required.'
              : '本地优先、所见即所得的 Markdown 编辑器。文件保存在你的设备中，无需注册账号。'}
          </p>
          <div className="about-update-row">
            <div>
              <strong>{en ? `Current version ${appVersion}` : `当前版本 ${appVersion}`}</strong>
              <p aria-live="polite">{updateStatusText(updater, en)}</p>
            </div>
            <button
              className="secondary-btn"
              disabled={updater.state.phase === 'checking' || updater.state.phase === 'downloading'}
              onClick={() => void updater.checkNow(true)}
            >
              <RefreshCw size={14} className={updater.state.phase === 'checking' ? 'spin' : ''} />
              {en ? 'Check for updates' : '检查更新'}
            </button>
          </div>
        </SettingsCard>
        <section className="about-resources" aria-labelledby="about-resources-title">
          <h3 id="about-resources-title">{en ? 'Resources' : '常用资源'}</h3>
          <div className="about-resource-list">
            {[
              [ABOUT_LINKS.guide, BookOpen, en ? 'User guide' : '使用指南'],
              [ABOUT_LINKS.releases, ScrollText, en ? 'Release notes' : '更新日志'],
              [ABOUT_LINKS.feedback, Bug, en ? 'Feedback' : '问题反馈'],
            ].map(([url, Icon, label]) => (
              <button
                key={String(url)}
                className="about-resource-row"
                onClick={() => void desktop.openExternal(String(url))}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{String(label)}</span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
        <section className="about-support-card">
          <div className="about-support-icon" aria-hidden="true">
            <HeartHandshake size={20} />
          </div>
          <div className="about-support-copy">
            <h3>{en ? 'Support Xiangzi MD' : '支持 Xiangzi MD'}</h3>
            <p>
              {en
                ? 'If Xiangzi MD saves you time, you can support its continued development.'
                : '如果 Xiangzi MD 为你节省了时间，欢迎支持项目持续更新。'}
            </p>
          </div>
          <button className="primary-btn" onClick={() => setSupportOpen(true)}>
            {en ? 'Support' : '支持项目'}
          </button>
        </section>
        <nav
          className="about-legal-links"
          aria-label={en ? 'Legal and project links' : '法律与项目链接'}
        >
          <button onClick={() => setLicenseOpen(true)}>
            {en ? 'Open-source license' : '开源许可'}
          </button>
          <span aria-hidden="true">·</span>
          <button onClick={() => void desktop.openExternal(ABOUT_LINKS.privacy)}>
            {en ? 'Privacy' : '隐私说明'}
          </button>
          <span aria-hidden="true">·</span>
          <button onClick={() => void desktop.openExternal(ABOUT_LINKS.project)}>
            {en ? 'GitHub project' : 'GitHub 项目主页'}
          </button>
        </nav>
        <p className="about-copyright">© {new Date().getFullYear()} guoxiangzi · MIT License</p>
      </SettingsPage>

      {licenseOpen && (
        <div
          className="modal-backdrop license-backdrop"
          onClick={(event) => {
            event.stopPropagation()
            setLicenseOpen(false)
          }}
        >
          <section
            className="modal license-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="license-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <span id="license-title">{en ? 'Open-source license' : '开源许可'}</span>
              <button
                className="icon-btn sm"
                aria-label={en ? 'Close license' : '关闭许可'}
                onClick={() => setLicenseOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="license-content">
              <h2>MIT License</h2>
              <p>
                {en
                  ? 'You may use, copy, modify, distribute, and commercially use this software. The original copyright and license notice must be retained.'
                  : '你可以使用、复制、修改、分发及商业使用本软件，但必须保留原始版权和许可声明。'}
              </p>
              <pre>{licenseText.trim()}</pre>
            </div>
          </section>
        </div>
      )}
      {supportOpen && (
        <div
          className="modal-backdrop support-backdrop"
          onClick={(event) => {
            event.stopPropagation()
            setSupportOpen(false)
          }}
        >
          <section
            className="modal support-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <span id="support-title">{en ? 'Support Xiangzi MD' : '支持 Xiangzi MD'}</span>
              <button
                className="icon-btn sm"
                aria-label={en ? 'Close support options' : '关闭支持方式'}
                onClick={() => setSupportOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="support-content">
              <p className="support-intro">
                {en
                  ? 'Xiangzi MD is independently developed and maintained by guoxiangzi. If it saves you time, you can voluntarily support its continued development.'
                  : 'Xiangzi MD 由 guoxiangzi 独立开发和维护。如果它为你节省了时间，欢迎自愿支持项目持续更新。'}
              </p>
              <div className="support-options">
                <article className="support-option support-option-alipay">
                  <h3>{en ? 'Alipay' : '支付宝'}</h3>
                  <div className="support-qr-crop support-qr-crop-alipay">
                    <img
                      src={alipaySupportQr}
                      alt={en ? 'Alipay support QR code' : '支付宝支持二维码'}
                    />
                  </div>
                  <p>{en ? 'Scan with Alipay' : '使用支付宝扫码支持'}</p>
                </article>
                <article className="support-option support-option-wechat">
                  <h3>{en ? 'WeChat Pay' : '微信支付'}</h3>
                  <div className="support-qr-crop support-qr-crop-wechat">
                    <img
                      src={wechatSupportQr}
                      alt={en ? 'WeChat Pay support QR code' : '微信支付支持二维码'}
                    />
                  </div>
                  <p>{en ? 'Scan with WeChat' : '使用微信扫码支持'}</p>
                </article>
                <article className="support-option support-option-paypal">
                  <h3>PayPal</h3>
                  <img src={paypalSupportQr} alt="PayPal support QR code" />
                  <button
                    className="secondary-btn"
                    onClick={() => void desktop.openExternal(PAYPAL_SUPPORT_URL)}
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    {en ? 'Open PayPal' : '打开 PayPal'}
                  </button>
                </article>
              </div>
              <p className="support-note">
                {en
                  ? 'Support is voluntary and does not purchase software, a subscription, feature delivery, or technical support.'
                  : '支持是自愿行为，不构成软件购买、订阅、功能交付或技术支持承诺。'}
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
