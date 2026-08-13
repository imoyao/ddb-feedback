// Email HTML templates — auto-imported by Nitro.
// Brand primary color matches public/logo.svg.
import { STATUS_CONFIG } from '../../shared/types/post'
import { normalizeBrandHex, pickBrandForegroundHex } from '../../shared/utils/branding'

const BRAND_COLOR = '#C45A46'
const FONT_STACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

function layout({ preheader, content }: { preheader: string; content: string }): string {
  return `
<div style="font-family: ${FONT_STACK}; max-width: 600px; margin: 0 auto; padding: 32px 24px; color: #111827; line-height: 1.55;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${preheader}</div>
  <div style="padding-bottom: 20px; border-bottom: 1px solid #e5e7eb; margin-bottom: 24px;">
    <span style="font-size: 20px; font-weight: 700; color: ${BRAND_COLOR}; letter-spacing: -0.01em;">多多贝</span>
  </div>
  ${content}
  ${signature()}
</div>
`
}

function actionButton(url: string, label: string): string {
  return `<a href="${url}" style="display: inline-block; padding: 12px 24px; background: ${BRAND_COLOR}; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">${label}</a>`
}

function fallbackLink(url: string): string {
  const shown = url.length <= 80 ? url : `${url.slice(0, 80)}...`
  return `
<p style="color: #6b7280; margin: 24px 0 4px; font-size: 13px;">按钮无法点击？请将下方链接复制到浏览器打开：</p>
<p style="margin: 0 0 24px; font-size: 12px; word-break: break-all;">
  <a href="${url}" style="color: ${BRAND_COLOR}; text-decoration: underline;">${shown}</a>
</p>
`
}

function expiryNote(text: string): string {
  return `<p style="color: #6b7280; margin: 0 0 24px; font-size: 13px;">${text}</p>`
}

function signature(): string {
  return `
<div style="border-top: 1px solid #e5e7eb; padding-top: 20px; color: #6b7280; font-size: 13px;">
  &mdash; 多多贝团队<br>
  <a href="https://duoduobei.com" style="color: #6b7280; text-decoration: underline;">duoduobei.com</a>
  &middot;
  <a href="mailto:feedback@duoduobei.com" style="color: #6b7280; text-decoration: underline;">feedback@duoduobei.com</a>
</div>
`
}

// --- Templates ---

export function renderVerificationEmail({ url, name }: { url: string; name: string }): string {
  return layout({
    preheader: '一键激活 · 链接 1 小时内有效。',
    content: `
<h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">确认邮箱，开始使用</h2>
<p style="margin: 0 0 12px;">你好 ${escapeHtml(name)}，</p>
<p style="margin: 0 0 12px;">确认邮箱以激活你的多多贝账户，即可开始：</p>
<ul style="margin: 0 0 24px; padding-left: 20px; color: #374151;">
  <li style="margin-bottom: 4px;">为你关心的功能投票</li>
  <li style="margin-bottom: 4px;">提交反馈与想法</li>
  <li>关注即将上线的更新</li>
</ul>
${actionButton(url, '确认邮箱')}
${fallbackLink(url)}
${expiryNote('此链接 1 小时内有效。如果你并未注册多多贝，请忽略此邮件。')}
`,
  })
}

export function renderInvitationEmail({ url, orgName }: { url: string; orgName: string }): string {
  return layout({
    preheader: `你被邀请加入 ${escapeHtml(orgName)}（多多贝）。`,
    content: `
<h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">加入 ${escapeHtml(orgName)}（多多贝）</h2>
<p style="margin: 0 0 12px;">你被邀请协作。点击下方按钮接受邀请并开始：</p>
${actionButton(url, '接受邀请')}
${fallbackLink(url)}
${expiryNote('此邀请链接与你的邮箱绑定。如果你并未期待此邀请，请忽略此邮件。')}
`,
  })
}

export function renderResetPasswordEmail({ url, name }: { url: string; name: string }): string {
  return layout({
    preheader: '我们收到了你的账户密码重置请求。若非本人操作，请忽略此邮件。',
    content: `
<h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">重置密码</h2>
<p style="margin: 0 0 12px;">你好 ${escapeHtml(name)}，</p>
<p style="margin: 0 0 24px;">有人请求重置你的多多贝账户密码。如果是你本人操作，请点击下方按钮设置新密码：</p>
${actionButton(url, '重置密码')}
${fallbackLink(url)}
${expiryNote('此链接 1 小时内有效，且仅可使用一次。')}
<div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-bottom: 24px;">
  <p style="margin: 0 0 12px; font-weight: 600; color: #111827;">没有请求重置？</p>
  <p style="margin: 0 0 12px; color: #374151;">你可以安全地忽略此邮件 &mdash; 除非点击上方链接，否则你的密码不会改变。</p>
</div>
`,
  })
}

export function renderPasswordSetEmail({ name }: { name: string }): string {
  const contact = `<a href="mailto:feedback@duoduobei.com" style="color: ${BRAND_COLOR}; text-decoration: underline;">feedback@duoduobei.com</a>`
  return layout({
    preheader: '若非本人操作，请立即重置密码。',
    content: `
<h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">你的账户已添加密码</h2>
<p style="margin: 0 0 16px;">你好 ${escapeHtml(name)}，</p>
<p style="margin: 0 0 16px;">你的多多贝账户刚刚添加了密码。现在除了社交登录，你也可以使用邮箱和密码登录。</p>
<p style="margin: 0 0 24px; color: #374151;">若非本人操作，请立即重置密码并联系 ${contact}。</p>
`,
  })
}

// --- Notification templates (中文，Featurebase 风格) ---

// User-authored text (titles, notes, comment snippets) enters the HTML body
// here, so every interpolation is escaped.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export interface NotificationEmailContent {
  subject: string
  html: string
  text: string
}

const FOOTER_REASON = '你收到此邮件是因为你在多多贝看板上的活动。'
const ADMIN_FOOTER_REASON = '你收到此邮件是因为你管理着多多贝看板。'

// Gray page → centered 多多贝 wordmark → white rounded card → centered footer.
// No links in the footer; the physical postal address (CAN-SPAM) is a pre-launch
// item, not fabricated here.
function notificationShell(cardInner: string, preheader: string, footerReason: string): string {
  return `
<div style="background: #f6f7fb; padding: 40px 16px; font-family: ${FONT_STACK};">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(preheader)}</div>
  <div style="max-width: 560px; margin: 0 auto;">
    <div style="text-align: center; padding-bottom: 28px;">
      <span style="font-size: 22px; font-weight: 800; color: {{brand}}; letter-spacing: -0.02em;">多多贝</span>
    </div>
    <div style="background: #fff; border: 1px solid #eceef3; border-radius: 16px; padding: 40px 36px;">
${cardInner}
    </div>
    <div style="text-align: center; padding: 24px 8px 0; color: #9ca3af; font-size: 12px; line-height: 1.6;">
      <p style="margin: 0;">${footerReason}</p>
    </div>
  </div>
</div>`
}

function pillButton(url: string, label: string): string {
  return `<div style="text-align: center; margin-top: 32px;"><a href="${url}" style="display: inline-block; padding: 14px 40px; background: {{brand}}; color: {{brandFg}}; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 16px;">${label}</a></div>`
}

function statusChangeCard(title: string, to: string, note?: string): NotificationEmailContent {
  const cfg = STATUS_CONFIG[to as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open
  const label = cfg.label
  const noteHtml = note
    ? `<p style="margin: 20px 0 0; text-align: center; font-size: 15px; color: #6b7280; line-height: 1.7;">${escapeHtml(note)}</p>`
    : ''
  const inner = `
      <p style="margin: 0; text-align: center; font-size: 20px; line-height: 1.5; color: #1f2937;">
        你点赞的帖子 <strong style="color: #111827;">${escapeHtml(title)}</strong> 状态已变更为 <span style="color: ${cfg.color}; font-weight: 700;">${label}</span>
      </p>${noteHtml}
      ${pillButton('{{postUrl}}', '查看帖子')}`
  return {
    subject: `${label} - 「${title}」`,
    html: inner,
    text: `你点赞的帖子「${title}」状态已变更为 ${label}。${note ? `\n\n${note}` : ''}`,
  }
}

function personCard(title: string, actorName: string, actorImage: string | null | undefined, snippet: string, buttonLabel: string): string {
  const initial = (actorName || '?').charAt(0).toUpperCase()
  // Only trust an http(s) URL as a src; anything else falls back to the initial avatar.
  const safeImage = actorImage && /^https?:\/\//i.test(actorImage) ? actorImage : null
  const avatar = safeImage
    ? `<img src="${escapeHtml(safeImage)}" width="40" height="40" style="border-radius: 999px; display: block;" alt="">`
    : `<div style="width: 40px; height: 40px; border-radius: 999px; background: {{brand}}; color: {{brandFg}}; font-size: 16px; font-weight: 700; text-align: center; line-height: 40px;">${escapeHtml(initial)}</div>`
  return `
      <p style="margin: 0 0 20px; font-size: 17px; font-weight: 700; color: #111827; line-height: 1.4;">${escapeHtml(title)}</p>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        <td width="48" valign="top">${avatar}</td>
        <td valign="top" style="padding-left: 4px;">
          <div style="font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 4px;">${escapeHtml(actorName)}</div>
          <div style="font-size: 15px; color: #6b7280; line-height: 1.7;">${escapeHtml(snippet)}</div>
        </td>
      </tr></table>
      ${pillButton('{{postUrl}}', buttonLabel)}`
}

function adminReplyCard(title: string, actorName: string, actorImage: string | null | undefined, snippet: string): NotificationEmailContent {
  return {
    subject: `「${title}」收到官方回复`,
    html: personCard(title, actorName, actorImage, snippet, '查看回复'),
    text: `${actorName} 在「${title}」中回复：\n\n${snippet}`,
  }
}

function newFeedbackCard(title: string, actorName: string, actorImage: string | null | undefined, snippet: string): NotificationEmailContent {
  return {
    subject: `新反馈：「${title}」`,
    html: personCard(title, actorName, actorImage, snippet, '查看反馈'),
    text: `${actorName} 提交了新反馈「${title}」：\n\n${snippet}`,
  }
}

function userCommentCard(title: string, actorName: string, actorImage: string | null | undefined, snippet: string): NotificationEmailContent {
  return {
    subject: `「${title}」有新回复`,
    html: personCard(title, actorName, actorImage, snippet, '查看回复'),
    text: `${actorName} 在「${title}」中回复：\n\n${snippet}`,
  }
}

// Dispatch a notification to its template. Returns null for an unknown type so
// the caller logs it rather than sending a blank email.
export function renderNotificationEmail(input: {
  typeKey: string
  postTitle?: string
  postUrl: string
  to?: string
  note?: string
  snippet?: string
  actorName?: string
  actorImage?: string | null
  brandColor?: string
}): NotificationEmailContent | null {
  const title = input.postTitle || '你的帖子'
  let card: NotificationEmailContent | null = null
  let preheader = ''
  let footerReason = FOOTER_REASON

  switch (input.typeKey) {
    case 'post.status_changed': {
      const label = (STATUS_CONFIG[(input.to ?? 'open') as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open).label
      card = statusChangeCard(title, input.to ?? 'open', input.note)
      preheader = `「${title}」现已${label}。`
      break
    }
    case 'post.admin_replied':
      card = adminReplyCard(title, input.actorName ?? '官方团队', input.actorImage, input.snippet ?? '')
      preheader = `「${title}」收到官方回复。`
      break
    case 'post.created':
      card = newFeedbackCard(title, input.actorName ?? '有人', input.actorImage, input.snippet ?? '')
      preheader = `你的看板收到新反馈：「${title}」。`
      footerReason = ADMIN_FOOTER_REASON
      break
    case 'post.user_commented':
      card = userCommentCard(title, input.actorName ?? '有人', input.actorImage, input.snippet ?? '')
      preheader = `「${title}」收到新回复。`
      footerReason = ADMIN_FOOTER_REASON
      break
    default:
      return null
  }

  const brand = normalizeBrandHex(input.brandColor)
  const html = notificationShell(card.html.replaceAll('{{postUrl}}', input.postUrl), preheader, footerReason)
    .replaceAll('{{brand}}', brand)
    .replaceAll('{{brandFg}}', pickBrandForegroundHex(brand))
  const text = `${card.text}\n\n查看：${input.postUrl}\n\n—\n${footerReason}`
  return { subject: card.subject, html, text }
}
