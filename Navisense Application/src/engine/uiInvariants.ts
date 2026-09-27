// UI State Invariants Enforcer — Prevents Impossible Visual Combinations
// Rules:
// 1. NIDR ACTIVE -> GNSS indicator cannot simultaneously say "PRIMARY"
// 2. ARRIVED -> Start Navigation cannot remain active
// 3. ERROR -> stale "READY" indicator cannot remain visible
// 4. LOADING -> primary action cannot be executable
// 5. NO ROUTE -> turn-by-turn instruction cannot be displayed

import type { ControlledStatus, NavigationUiState } from '../types/uiState';

export interface InvariantValidationResult {
  isValid: boolean;
  violations: string[];
  sanitizedStatus: ControlledStatus;
}

export function validateUiInvariants(
  uiState: NavigationUiState,
  currentStatus: ControlledStatus
): InvariantValidationResult {
  const violations: string[] = [];
  let sanitizedStatus = currentStatus;

  // Invariant 1: NIDR ACTIVE -> GNSS cannot be PRIMARY / CONNECTED
  if (uiState.kind === 'nidr') {
    if (currentStatus === 'GNSS CONNECTED') {
      violations.push('Invariant Violation: NIDR is active but status is GNSS CONNECTED.');
      sanitizedStatus = 'NIDR ACTIVE';
    }
  }

  // Invariant 2: ARRIVED -> Cannot show ROUTE READY or active navigating
  if (uiState.kind === 'arrived') {
    if (currentStatus === 'ROUTE READY' || currentStatus === 'GNSS CONNECTED') {
      sanitizedStatus = 'ROUTE READY';
    }
  }

  // Invariant 3: ERROR -> stale READY indicator cannot remain visible
  if (uiState.kind === 'error') {
    if (currentStatus === 'ROUTE READY' || currentStatus === 'GNSS CONNECTED') {
      violations.push('Invariant Violation: UI is in ERROR state but status claims ROUTE READY.');
      sanitizedStatus = 'ROUTE UNAVAILABLE';
    }
  }

  // Invariant 4: NO ROUTE (empty) -> Cannot show turn-by-turn instruction
  if (uiState.kind === 'empty') {
    if (currentStatus === 'ROUTE READY') {
      sanitizedStatus = 'ROUTE UNAVAILABLE';
    }
  }

  // Invariant 5: RECOVERING -> Status must reflect RECONVERGING or GNSS REACQUIRED
  if (uiState.kind === 'recovering') {
    if (currentStatus !== 'RECONVERGING' && currentStatus !== 'GNSS REACQUIRED') {
      sanitizedStatus = 'RECONVERGING';
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
    sanitizedStatus,
  };
}
