// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { KeychronSettings } from '../KeychronSettings'
import { emptyKeychronState } from '../../../../shared/types/keychron'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('KeychronSettings', () => {
  it('renders adaptive NKRO as checked, disabled, and visually muted', () => {
    const keychron = {
      ...emptyKeychronState(),
      hasNkro: true,
      nkroSupported: true,
      nkroAdaptive: true,
      nkroEnabled: true,
    }

    render(<KeychronSettings keychron={keychron} />)

    const checkbox = screen.getByTestId('keychron-nkro') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    expect(checkbox).toBeDisabled()
    expect(checkbox.className).toContain('disabled:opacity-50')
  })
})
