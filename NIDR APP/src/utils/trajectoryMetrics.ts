import { EvaluationMetrics, TrajectoryPoint } from '../types';
import { geodeticToEnu, haversineDistanceM } from './coordinateUtils';

/**
 * Computes scientific evaluation metrics comparing an IDR trajectory
 * against an independent Reference GNSS trajectory.
 */
export function calculateEvaluationMetrics(
  referencePoints: TrajectoryPoint[],
  idrPoints: TrajectoryPoint[],
  targetDriftPercent: number = 20.0 // 20% for internal pedestrian prototype, 10% for SIH
): EvaluationMetrics | null {
  if (referencePoints.length < 2 || idrPoints.length < 2) {
    return null;
  }

  // Anchor to first reference coordinate
  const lat0 = referencePoints[0].latitude;
  const lon0 = referencePoints[0].longitude;

  // Compute cumulative distance along reference trajectory
  const refDistances: number[] = [0];
  for (let i = 1; i < referencePoints.length; i++) {
    const d = haversineDistanceM(
      referencePoints[i - 1].latitude,
      referencePoints[i - 1].longitude,
      referencePoints[i].latitude,
      referencePoints[i].longitude
    );
    refDistances.push(refDistances[i - 1] + d);
  }
  const totalRefDistance = refDistances[refDistances.length - 1];

  // Compute cumulative distance along IDR trajectory
  let totalIdrDistance = 0;
  for (let i = 1; i < idrPoints.length; i++) {
    totalIdrDistance += haversineDistanceM(
      idrPoints[i - 1].latitude,
      idrPoints[i - 1].longitude,
      idrPoints[i].latitude,
      idrPoints[i].longitude
    );
  }

  // Time-synchronized pointwise comparison
  const errors: number[] = [];
  const alongTrackErrors: number[] = [];
  const crossTrackErrors: number[] = [];
  const pointwiseErrors: EvaluationMetrics['pointwiseErrors'] = [];

  for (const idrPt of idrPoints) {
    // Find closest reference point by timestamp
    const refMatch = findClosestPointByTime(referencePoints, idrPt.unixTimeMs);
    if (!refMatch) continue;

    const refEnu = geodeticToEnu(refMatch.point.latitude, refMatch.point.longitude, lat0, lon0);
    const idrEnu = geodeticToEnu(idrPt.latitude, idrPt.longitude, lat0, lon0);

    const dE = idrEnu.east - refEnu.east;
    const dN = idrEnu.north - refEnu.north;
    const errorM = Math.sqrt(dE * dE + dN * dN);

    // Reference heading decomposition (along-track vs cross-track)
    const headingRad = ((refMatch.point.headingDeg || 0) * Math.PI) / 180.0;
    const alongTrack = Math.abs(dE * Math.sin(headingRad) + dN * Math.cos(headingRad));
    const crossTrack = Math.abs(dE * Math.cos(headingRad) - dN * Math.sin(headingRad));

    errors.push(errorM);
    alongTrackErrors.push(alongTrack);
    crossTrackErrors.push(crossTrack);

    const currentRefDist = refDistances[refMatch.index] || 0.1;
    const driftPct = (errorM / Math.max(currentRefDist, 1.0)) * 100.0;

    pointwiseErrors.push({
      unixTimeMs: idrPt.unixTimeMs,
      referenceDistanceM: currentRefDist,
      errorM,
      driftPercent: driftPct,
    });
  }

  if (errors.length === 0) return null;

  const finalError = errors[errors.length - 1];
  const maxError = Math.max(...errors);
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;

  const sortedErrors = [...errors].sort((a, b) => a - b);
  const p95Index = Math.min(Math.floor(sortedErrors.length * 0.95), sortedErrors.length - 1);
  const p95Error = sortedErrors[p95Index];

  const finalDrift = (finalError / Math.max(totalRefDistance, 1.0)) * 100.0;
  const maxDrift = Math.max(...pointwiseErrors.map(p => p.driftPercent));

  const meanAlongTrack = alongTrackErrors.reduce((a, b) => a + b, 0) / alongTrackErrors.length;
  const meanCrossTrack = crossTrackErrors.reduce((a, b) => a + b, 0) / crossTrackErrors.length;

  return {
    totalReferenceDistanceM: totalRefDistance,
    totalIdrDistanceM: totalIdrDistance,
    finalErrorM: finalError,
    maxPointwiseErrorM: maxError,
    meanPointwiseErrorM: meanError,
    p95PointwiseErrorM: p95Error,
    finalDriftPercent: finalDrift,
    maxDriftPercent: maxDrift,
    meanAlongTrackErrorM: meanAlongTrack,
    meanCrossTrackErrorM: meanCrossTrack,
    isTargetMet: finalDrift <= targetDriftPercent,
    pointwiseErrors,
  };
}

function findClosestPointByTime(
  points: TrajectoryPoint[],
  targetUnixMs: number
): { point: TrajectoryPoint; index: number } | null {
  if (points.length === 0) return null;

  let closestIdx = 0;
  let minDiff = Math.abs(points[0].unixTimeMs - targetUnixMs);

  for (let i = 1; i < points.length; i++) {
    const diff = Math.abs(points[i].unixTimeMs - targetUnixMs);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }

  return { point: points[closestIdx], index: closestIdx };
}
