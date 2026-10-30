'use client'

import { useId } from 'react'
import { deviceLabel, type InputDevice, type MicFailure, type MicSettings } from '@/lib/space-mic'
import { LevelMeter } from './stage'

const SWITCHES: { key: 'noiseSuppression' | 'echoCancellation' | 'autoGainControl'; label: string; hint: string }[] = [
  { key: 'noiseSuppression', label: 'Noise suppression', hint: 'Hushes steady background noise such as a fan or a generator. Turn it off if you are playing music.' },
  { key: 'echoCancellation', label: 'Echo cancellation', hint: 'Stops the sound from your speaker looping back into your microphone. Keep it on unless you use headphones.' },
  { key: 'autoGainControl', label: 'Automatic volume', hint: 'Evens out how loud you sound. Turn it off if your voice seems to pump up and down.' },
]

export function MicPanel({
  settings,
  devices,
  noDevice,
  fellBack,
  failure,
  live,
  level,
  onChange,
}: {
  settings: MicSettings
  devices: InputDevice[]
  noDevice: boolean
  /** The chosen input is unplugged and the default is in use. */
  fellBack: boolean
  failure: MicFailure | null
  live: boolean
  level: number
  onChange: (next: MicSettings) => void
}) {
  const selectId = useId()
  return (
    <div className="space-mic-panel">
      {failure ? (
        <p role="alert" className="notice notice-danger">
          {failure.message}
        </p>
      ) : null}
      {noDevice ? <p className="notice">No microphone found. Plug one in or connect a headset. You can keep listening meanwhile.</p> : null}
      {fellBack ? <p className="notice">The microphone you chose is not plugged in, so the default one is in use. Plug it back in and it is picked up again.</p> : null}

      <label htmlFor={selectId} className="field-label">
        Microphone
      </label>
      <select
        id={selectId}
        className="field mt-1"
        disabled={devices.length === 0}
        value={settings.deviceId ?? ''}
        onChange={(event) => onChange({ ...settings, deviceId: event.target.value || null })}
      >
        <option value="">Default microphone</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {deviceLabel(d, i)}
          </option>
        ))}
      </select>

      <div className="mt-4">
        <p className="field-label">Input level</p>
        <LevelMeter level={level} />
        <p className="field-hint mt-1">{live ? 'Say a few words. The bar should move.' : 'Tap Unmute to test your microphone. Nobody hears you until then.'}</p>
      </div>

      <fieldset className="mt-4">
        <legend className="field-label">Sound clean-up</legend>
        <p className="field-hint">Your browser does this. Your voice is otherwise sent as it is: HeyNaija does not offer voice changers.</p>
        {SWITCHES.map(({ key, label, hint }) => (
          <label key={key} className="space-switch">
            <input type="checkbox" checked={settings[key]} onChange={(event) => onChange({ ...settings, [key]: event.target.checked })} />
            <span>
              <span className="font-semibold">{label}</span>
              <span className="field-hint block">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  )
}
