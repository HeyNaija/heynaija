import 'server-only'
import { linkClass } from '@/lib/auth/link-class'
import type { AuthFormProps, FrontendAuthProvider } from '../../types'
import { getApiAuthHeaders, getFlow, getFlowError, getLogoutUrl, getSessionEmail, hasSessionCredentials, startFlowUrl } from './client'
import { FlowForm } from './flow-form'
import { ForgetFlowParam } from './forget-flow'
import { isLogoutUrl } from './urls'

async function Form({ kind, flowId }: AuthFormProps) {
  const flow = await getFlow(kind, flowId)
  if (kind === 'settings') {
    const shown = Boolean(flow.ui.messages?.length) || flow.ui.nodes.some((node) => node.messages?.length)
    const confirmingEmail = flow.ui.nodes.some((node) => node.attributes.name === 'email_change_code')
    return (
      <>
        {shown && !confirmingEmail ? <ForgetFlowParam /> : null}
        <FlowForm
          flow={flow}
          sections={{ profile: 'Email and handle', oidc: 'Connected accounts' }}
          fallback="Your change was not saved. Make it again and press Save."
        />
      </>
    )
  }
  if (kind === 'registration') return <FlowForm flow={flow} signup />
  if (kind !== 'login' || !flow.refresh) return <FlowForm flow={flow} />

  // Already signed in, confirming it is them before a change in Settings.
  const [email, logoutUrl] = await Promise.all([getSessionEmail(), getLogoutUrl()])
  return (
    <div className="flex flex-col gap-5">
      <FlowForm flow={flow} identifier={email ?? undefined} />
      {logoutUrl ? (
        <p className="text-sm text-muted">
          Not you?{' '}
          <a href={`/logout?to=${encodeURIComponent(logoutUrl)}`} className={linkClass}>
            Sign out
          </a>
        </p>
      ) : null}
    </div>
  )
}

export const kratosAuth: FrontendAuthProvider = {
  Form,
  startUrl: startFlowUrl,
  getLogoutUrl,
  isLogoutUrl,
  getFlowError,
  getApiAuthHeaders,
  hasSessionCredentials,
}
