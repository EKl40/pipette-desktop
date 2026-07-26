// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
//
// Focuses on `applyVilFile`'s `keymapRestoreSeq` bump — the single signal
// App.tsx's restore-cleanup effect watches for (Plan-qwerty-select-no-rewrite
// §snapshot/.vil 復元時のクリーンアップ, D1). Snapshot/layout-store restore
// and `.vil` import both converge on this function, so proving the bump
// fires here covers both call sites without needing App.tsx's own harness.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState, useRef } from 'react'
import { useKeyboardPersistence } from '../useKeyboardPersistence'
import { emptyState, type KeyboardState, type SetState, type KeyboardRefs, type BootGuardRef } from '../keyboard-types'
import { emptyKeychronState } from '../../../shared/types/keychron'
import type { VilFile } from '../../../shared/types/protocol'
import * as keychronSerialize from '../../../shared/keychron-serialize'
import { VALID_VIL, MODIFIED_VIL } from './fixtures/valid-vil'

function createState(overrides?: Partial<KeyboardState>): KeyboardState {
  return {
    ...emptyState(),
    uid: 'device-uid',
    rows: 2,
    cols: 2,
    layers: 2,
    vialProtocol: 9,
    viaProtocol: 9,
    keymap: new Map([
      ['0,0,0', 4],
      ['0,0,1', 5],
    ]),
    encoderLayout: new Map([
      ['0,0,0', 6],
    ]),
    macroBuffer: [1, 2, 3],
    macroCount: 1,
    tapDanceEntries: [{ onTap: 4, onHold: 5, onDoubleTap: 6, onTapHold: 7, tappingTerm: 200 }],
    comboEntries: [{ key1: 4, key2: 5, key3: 0, key4: 0, output: 6 }],
    keyOverrideEntries: [],
    altRepeatKeyEntries: [],
    qmkSettingsValues: { '1': [10, 11] },
    layerNames: ['Base', 'Fn'],
    unlockStatus: { unlocked: true, inProgress: false, keys: [] },
    ...overrides,
  }
}

function setupPersistence(initialState: KeyboardState) {
  const stateRef = { current: initialState }
  const qmkSettingsBaselineRef = { current: {} }
  const saveLayerNames = vi.fn()
  const saveLayerNamesRef = { current: saveLayerNames }
  const refs = {
    stateRef,
    qmkSettingsBaselineRef,
    saveLayerNamesRef,
  } as unknown as KeyboardRefs

  const setState: SetState = ((update: KeyboardState | ((prev: KeyboardState) => KeyboardState)) => {
    stateRef.current = typeof update === 'function'
      ? (update as (prev: KeyboardState) => KeyboardState)(stateRef.current)
      : update
  }) as SetState

  const waitForUnlock = vi.fn(async () => {})
  const bootGuardRef = { current: { onUnlock: null } }
  const bumpActivity = vi.fn()

  const hook = renderHook(() => useKeyboardPersistence(
    setState,
    refs,
    bumpActivity,
    bootGuardRef,
    waitForUnlock,
  ))

  return {
    ...hook,
    stateRef,
    qmkSettingsBaselineRef,
    saveLayerNames,
    waitForUnlock,
    bootGuardRef,
    bumpActivity,
  }
}

function useHarness(initial?: Partial<KeyboardState>) {
  const [state, setState] = useState<KeyboardState>({ ...emptyState(), isDummy: true, ...initial })
  const stateRef = useRef(state)
  stateRef.current = state
  const qmkSettingsBaselineRef = useRef<Record<string, number[]>>({})
  const saveLayerNamesRef = useRef<((names: string[]) => void) | null>(null)
  const bootGuardRef = useRef<BootGuardRef>({ onUnlock: null })
  const waitForUnlock = vi.fn(async () => {})
  const bumpActivity = vi.fn()

  const persistence = useKeyboardPersistence(
    setState,
    { stateRef, qmkSettingsBaselineRef, saveLayerNamesRef },
    bumpActivity,
    bootGuardRef,
    waitForUnlock,
  )

  return { state, ...persistence }
}

beforeEach(() => {
  window.vialAPI = {
    ...(window.vialAPI ?? {}),
    setKeycode: vi.fn(async () => {}),
    setEncoder: vi.fn(async () => {}),
    setMacroBuffer: vi.fn(async () => {}),
    setLayoutOptions: vi.fn(async () => {}),
    setTapDance: vi.fn(async () => {}),
    setCombo: vi.fn(async () => {}),
    setKeyOverride: vi.fn(async () => {}),
    setAltRepeatKey: vi.fn(async () => {}),
    qmkSettingsSet: vi.fn(async () => {}),
    keychronReload: vi.fn(async () => ({ ...emptyKeychronState(), hasNkro: true })),
  } as unknown as typeof window.vialAPI
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useKeyboardPersistence', () => {
  it('serializes the normal snapshot payload and preserves keychron data', () => {
    const keychron = {
      ...emptyKeychronState(),
      hasNkro: true,
      nkroEnabled: true,
      nkroSupported: true,
    }
    const state = createState({
      keychron,
      vialRGBSupported: [1],
      vialRGBMode: 7,
      vialRGBSpeed: 8,
      vialRGBHue: 9,
      vialRGBSat: 10,
      vialRGBVal: 11,
    })
    const serializeKeychronSpy = vi
      .spyOn(keychronSerialize, 'serializeKeychronState')
      .mockReturnValue({ nkro: { enabled: true } })

    const { result } = setupPersistence(state)

    const vil = result.current.serialize()

    expect(vil.uid).toBe('device-uid')
    expect(vil.keymap).toEqual({ '0,0,0': 4, '0,0,1': 5 })
    expect(vil.encoderLayout).toEqual({ '0,0,0': 6 })
    expect(vil.qmkSettings).toEqual({ '1': [10, 11] })
    expect(vil.layerNames).toEqual(['Base', 'Fn'])
    expect(vil.keychron).toEqual({ nkro: { enabled: true } })
    expect(serializeKeychronSpy).toHaveBeenCalledWith(
      keychron,
      { mode: 7, speed: 8, hue: 9, sat: 10, val: 11 },
    )
  })

  it('applies the normal restore flow and invokes keychron restore for keychron snapshots', async () => {
    const currentKeychron = {
      ...emptyKeychronState(),
      hasNkro: true,
      nkroSupported: true,
      nkroEnabled: false,
    }
    const state = createState({
      isDummy: false,
      keychron: currentKeychron,
    })
    const restoreKeychronSpy = vi
      .spyOn(keychronSerialize, 'restoreKeychronSettings')
      .mockResolvedValue(undefined)

    const { result, stateRef, saveLayerNames } = setupPersistence(state)

    const vil: VilFile = {
      version: 2,
      uid: 'saved-uid',
      keymap: { '0,0,0': 42 },
      encoderLayout: { '0,0,0': 43 },
      macros: [9, 8, 7],
      macroJson: [],
      layoutOptions: 3,
      tapDance: [],
      combo: [],
      keyOverride: [],
      altRepeatKey: [],
      qmkSettings: { '5': [1, 2] },
      layerNames: ['Saved Base', 'Saved Fn'],
      keychron: { nkro: { enabled: true } },
    }

    await act(async () => {
      await result.current.applyVilFile(vil)
    })

    expect(window.vialAPI.setKeycode).toHaveBeenCalledWith(0, 0, 0, 42)
    expect(window.vialAPI.setEncoder).toHaveBeenCalledWith(0, 0, 0, 43)
    expect(window.vialAPI.setMacroBuffer).toHaveBeenCalledWith([9, 8, 7])
    expect(window.vialAPI.setLayoutOptions).toHaveBeenCalledWith(3)
    expect(window.vialAPI.qmkSettingsSet).toHaveBeenCalledWith(5, [1, 2])
    expect(restoreKeychronSpy).toHaveBeenCalledWith(
      { nkro: { enabled: true } },
      currentKeychron,
      window.vialAPI,
      2,
      2,
    )
    expect(window.vialAPI.keychronReload).toHaveBeenCalled()
    expect(saveLayerNames).toHaveBeenCalledWith(['Saved Base', 'Saved Fn'])
    expect(stateRef.current.keymap.get('0,0,0')).toBe(42)
    expect(stateRef.current.encoderLayout.get('0,0,0')).toBe(43)
    expect(stateRef.current.qmkSettingsValues).toEqual({ '5': [1, 2] })
    expect(stateRef.current.layerNames).toEqual(['Saved Base', 'Saved Fn'])
  })

  it('waits for unlock before writing to a real device restore', async () => {
    const state = createState({
      isDummy: false,
      unlockStatus: { unlocked: false, inProgress: false, keys: [] },
    })
    const { result, waitForUnlock, bootGuardRef } = setupPersistence(state)

    const vil: VilFile = {
      version: 2,
      uid: 'saved-uid',
      keymap: { '0,0,0': 42 },
      encoderLayout: {},
      macros: [],
      macroJson: [],
      layoutOptions: 0,
      tapDance: [],
      combo: [],
      keyOverride: [],
      altRepeatKey: [],
      qmkSettings: {},
      layerNames: [],
    }

    await act(async () => {
      await result.current.applyVilFile(vil)
    })

    expect(waitForUnlock).toHaveBeenCalledOnce()
    expect(bootGuardRef.current.onUnlock).toBeNull()
    expect(window.vialAPI.setKeycode).toHaveBeenCalledWith(0, 0, 0, 42)
  })

  it('round-trips a normal save -> clean baseline -> restore flow', async () => {
    const originalState = createState({
      isDummy: false,
      keymap: new Map([
        ['0,0,0', 14],
        ['0,0,1', 15],
      ]),
      encoderLayout: new Map([
        ['0,0,0', 22],
      ]),
      macroBuffer: [7, 7, 7],
      tapDanceEntries: [{ onTap: 10, onHold: 11, onDoubleTap: 12, onTapHold: 13, tappingTerm: 180 }],
      comboEntries: [{ key1: 20, key2: 21, key3: 0, key4: 0, output: 22 }],
      qmkSettingsValues: { '2': [99] },
      layerNames: ['Main', 'Alt'],
      layoutOptions: 5,
    })

    const { result, stateRef } = setupPersistence(originalState)
    const saved = result.current.serialize()

    stateRef.current = createState({
      ...emptyState(),
      isDummy: false,
      rows: 2,
      cols: 2,
      layers: 2,
      uid: 'device-uid',
      viaProtocol: 9,
      vialProtocol: 9,
      unlockStatus: { unlocked: true, inProgress: false, keys: [] },
      keymap: new Map([
        ['0,0,0', 1],
      ]),
      encoderLayout: new Map(),
      macroBuffer: [],
      tapDanceEntries: [],
      comboEntries: [],
      qmkSettingsValues: {},
      layerNames: ['', ''],
      layoutOptions: 0,
    })

    await act(async () => {
      await result.current.applyVilFile(saved)
    })

    expect(stateRef.current.keymap.get('0,0,0')).toBe(14)
    expect(stateRef.current.keymap.get('0,0,1')).toBe(15)
    expect(stateRef.current.encoderLayout.get('0,0,0')).toBe(22)
    expect(stateRef.current.macroBuffer).toEqual([7, 7, 7])
    expect(stateRef.current.tapDanceEntries).toEqual(originalState.tapDanceEntries)
    expect(stateRef.current.comboEntries).toEqual(originalState.comboEntries)
    expect(stateRef.current.qmkSettingsValues).toEqual({ '2': [99] })
    expect(stateRef.current.layerNames).toEqual(['Main', 'Alt'])
    expect(stateRef.current.layoutOptions).toBe(5)
  })

  it('round-trips a keychron save -> clean baseline -> restore flow', async () => {
    const originalKeychron = {
      ...emptyKeychronState(),
      hasDebounce: true,
      debounceType: 1,
      debounceTime: 9,
      hasNkro: true,
      nkroSupported: true,
      nkroAdaptive: false,
      nkroEnabled: true,
      hasWireless: true,
      wirelessBacklitTime: 60,
      wirelessIdleTime: 600,
    }
    const restoreKeychronSpy = vi
      .spyOn(keychronSerialize, 'restoreKeychronSettings')
      .mockResolvedValue(undefined)

    const { result, stateRef } = setupPersistence(createState({
      isDummy: false,
      keychron: originalKeychron,
      vialRGBSupported: [1],
      vialRGBMode: 3,
      vialRGBSpeed: 4,
      vialRGBHue: 5,
      vialRGBSat: 6,
      vialRGBVal: 7,
    }))

    const saved = result.current.serialize()
    expect(saved.keychron).toBeDefined()

    const reloadedKeychron = {
      ...emptyKeychronState(),
      hasDebounce: true,
      hasNkro: true,
      nkroSupported: true,
      hasWireless: true,
    }
    vi.mocked(window.vialAPI.keychronReload).mockResolvedValue(reloadedKeychron)

    stateRef.current = createState({
      ...emptyState(),
      isDummy: false,
      rows: 2,
      cols: 2,
      layers: 2,
      uid: 'device-uid',
      viaProtocol: 9,
      vialProtocol: 9,
      unlockStatus: { unlocked: true, inProgress: false, keys: [] },
      keychron: reloadedKeychron,
      keymap: new Map(),
      encoderLayout: new Map(),
      macroBuffer: [],
      qmkSettingsValues: {},
      layerNames: ['', ''],
    })

    await act(async () => {
      await result.current.applyVilFile(saved)
    })

    expect(restoreKeychronSpy).toHaveBeenCalledWith(
      saved.keychron,
      reloadedKeychron,
      window.vialAPI,
      2,
      2,
    )
    expect(window.vialAPI.keychronReload).toHaveBeenCalled()
    expect(stateRef.current.keychron).toEqual(reloadedKeychron)
  })
})

describe('useKeyboardPersistence — applyVilFile keymapRestoreSeq bump', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts at 0 and increments by exactly 1 on a successful restore', async () => {
    const { result } = renderHook(() => useHarness())
    expect(result.current.state.keymapRestoreSeq).toBe(0)

    await act(async () => {
      await result.current.applyVilFile(VALID_VIL)
    })

    expect(result.current.state.keymapRestoreSeq).toBe(1)
  })

  it('increments once per restore across repeated calls (.vil import and layout-store/snapshot restore both funnel through here)', async () => {
    const { result } = renderHook(() => useHarness())

    await act(async () => {
      await result.current.applyVilFile(VALID_VIL)
    })
    expect(result.current.state.keymapRestoreSeq).toBe(1)

    await act(async () => {
      await result.current.applyVilFile(MODIFIED_VIL)
    })
    expect(result.current.state.keymapRestoreSeq).toBe(2)
  })

  it('applies the keymap/encoder layout from the restored file alongside the bump', async () => {
    const { result } = renderHook(() => useHarness())

    await act(async () => {
      await result.current.applyVilFile(VALID_VIL)
    })

    expect(result.current.state.keymap.get('0,0,0')).toBe(0x4f)
    expect(result.current.state.encoderLayout.get('0,0,0')).toBe(0x81)
    expect(result.current.state.keymapRestoreSeq).toBe(1)
  })

  it('reset() (disconnect) carries the counter forward instead of zeroing it, so it does not look like a fresh restore to consumers watching for a change', async () => {
    const { result } = renderHook(() => useHarness())

    await act(async () => {
      await result.current.applyVilFile(VALID_VIL)
    })
    expect(result.current.state.keymapRestoreSeq).toBe(1)

    act(() => {
      result.current.reset()
    })
    expect(result.current.state.keymapRestoreSeq).toBe(1)
    // Everything else is wiped back to the empty-state defaults.
    expect(result.current.state.keymap.size).toBe(0)
  })
})
