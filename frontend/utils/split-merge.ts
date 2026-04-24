import type { TimelineSegment, SplitParams, MergeParams } from '@/components/job/types';

/**
 * Divise un segment en deux segments adjacents
 * @param segment Segment à diviser
 * @param splitTime Temps de division (doit être entre startTime et endTime)
 * @param leftText Texte pour le segment de gauche
 * @param rightText Texte pour le segment de droite
 * @returns Tuple [leftSegment, rightSegment] ou null si division impossible
 */
export function splitSegment(
  segment: TimelineSegment,
  splitTime: number,
  leftText: string = segment.text.substring(0, Math.floor(segment.text.length / 2)),
  rightText: string = segment.text.substring(Math.floor(segment.text.length / 2))
): [TimelineSegment, TimelineSegment] | null {
  // Validation
  if (splitTime <= segment.startTime || splitTime >= segment.endTime) {
    console.error('splitTime doit être entre startTime et endTime');
    return null;
  }

  if (segment.duration < 0.1) {
    console.error('Segment trop court pour être divisé');
    return null;
  }

  // Générer des IDs uniques
  const leftId = `${segment.id}-left`;
  const rightId = `${segment.id}-right`;

  // Calculer les durées
  const leftDuration = splitTime - segment.startTime;
  const rightDuration = segment.endTime - splitTime;

  // Créer les nouveaux segments
  const leftSegment: TimelineSegment = {
    id: leftId,
    startTime: segment.startTime,
    endTime: splitTime,
    duration: leftDuration,
    text: leftText || segment.text,
    translation: segment.translation ? 
      segment.translation.substring(0, Math.floor(segment.translation.length / 2)) : 
      undefined,
    style: segment.style,
    customOrder: segment.customOrder,
    isSelected: false,
    isDragging: false,
    isResizing: false
  };

  const rightSegment: TimelineSegment = {
    id: rightId,
    startTime: splitTime,
    endTime: segment.endTime,
    duration: rightDuration,
    text: rightText || segment.text,
    translation: segment.translation ? 
      segment.translation.substring(Math.floor(segment.translation.length / 2)) : 
      undefined,
    style: segment.style,
    customOrder: (segment.customOrder || 0) + 1, // Incrémenter l'ordre
    isSelected: false,
    isDragging: false,
    isResizing: false
  };

  return [leftSegment, rightSegment];
}

/**
 * Fusionne deux segments adjacents en un seul
 * @param segment1 Premier segment
 * @param segment2 Deuxième segment (doit être après segment1)
 * @param mergedText Texte fusionné (optionnel)
 * @returns Nouveau segment fusionné ou null si fusion impossible
 */
export function mergeSegments(
  segment1: TimelineSegment,
  segment2: TimelineSegment,
  mergedText: string = `${segment1.text} ${segment2.text}`
): TimelineSegment | null {
  // Validation
  if (segment1.endTime !== segment2.startTime && segment2.endTime !== segment1.startTime) {
    // Vérifier si les segments se touchent (avec une tolérance de 0.1s)
    const timeGap = Math.abs(segment1.endTime - segment2.startTime);
    if (timeGap > 0.1) {
      console.error('Les segments doivent être adjacents pour être fusionnés');
      return null;
    }
  }

  // Déterminer l'ordre chronologique
  const firstSegment = segment1.startTime < segment2.startTime ? segment1 : segment2;
  const secondSegment = segment1.startTime < segment2.startTime ? segment2 : segment1;

  // Calculer les nouvelles propriétés
  const newStartTime = Math.min(firstSegment.startTime, secondSegment.startTime);
  const newEndTime = Math.max(firstSegment.endTime, secondSegment.endTime);
  const newDuration = newEndTime - newStartTime;

  // Fusionner les traductions si disponibles
  let mergedTranslation: string | undefined;
  if (segment1.translation && segment2.translation) {
    mergedTranslation = `${segment1.translation} ${segment2.translation}`;
  } else if (segment1.translation) {
    mergedTranslation = segment1.translation;
  } else if (segment2.translation) {
    mergedTranslation = segment2.translation;
  }

  // Choisir le style du premier segment
  const newStyle = segment1.style || segment2.style;

  // Utiliser l'ordre du premier segment
  const newCustomOrder = firstSegment.customOrder || 0;

  // Créer le segment fusionné
  const mergedSegment: TimelineSegment = {
    id: `merged-${firstSegment.id}-${secondSegment.id}`,
    startTime: newStartTime,
    endTime: newEndTime,
    duration: newDuration,
    text: mergedText,
    translation: mergedTranslation,
    style: newStyle,
    customOrder: newCustomOrder,
    isSelected: false,
    isDragging: false,
    isResizing: false
  };

  return mergedSegment;
}

/**
 * Valide si un segment peut être divisé
 * @param segment Segment à valider
 * @param splitTime Temps de division proposé
 * @returns true si valide, false sinon
 */
export function canSplitSegment(segment: TimelineSegment, splitTime: number): boolean {
  if (!segment || splitTime <= 0) return false;
  
  const minSegmentDuration = 0.1; // 100ms minimum par segment
  const leftDuration = splitTime - segment.startTime;
  const rightDuration = segment.endTime - splitTime;
  
  return leftDuration >= minSegmentDuration && rightDuration >= minSegmentDuration;
}

/**
 * Valide si deux segments peuvent être fusionnés
 * @param segment1 Premier segment
 * @param segment2 Deuxième segment
 * @returns true si valide, false sinon
 */
export function canMergeSegments(segment1: TimelineSegment, segment2: TimelineSegment): boolean {
  if (!segment1 || !segment2) return false;
  
  // Vérifier qu'ils sont différents
  if (segment1.id === segment2.id) return false;
  
  // Vérifier la proximité temporelle
  const maxGap = 0.5; // 500ms maximum entre les segments
  const gap = Math.abs(segment1.endTime - segment2.startTime);
  
  return gap <= maxGap;
}

/**
 * Divise un segment et retourne les paramètres pour l'API
 * @param segment Segment à diviser
 * @param splitTime Temps de division
 * @returns Paramètres de division pour l'API
 */
export function prepareSplitParams(
  segment: TimelineSegment,
  splitTime: number
): SplitParams | null {
  if (!canSplitSegment(segment, splitTime)) {
    return null;
  }

  const leftText = segment.text.substring(0, Math.floor(segment.text.length / 2));
  const rightText = segment.text.substring(Math.floor(segment.text.length / 2));

  return {
    segmentId: segment.id,
    splitTime,
    leftText,
    rightText
  };
}

/**
 * Fusionne deux segments et retourne les paramètres pour l'API
 * @param segment1 Premier segment
 * @param segment2 Deuxième segment
 * @returns Paramètres de fusion pour l'API
 */
export function prepareMergeParams(
  segment1: TimelineSegment,
  segment2: TimelineSegment
): MergeParams | null {
  if (!canMergeSegments(segment1, segment2)) {
    return null;
  }

  const mergedText = `${segment1.text} ${segment2.text}`;

  return {
    segmentId1: segment1.id,
    segmentId2: segment2.id,
    mergedText
  };
}

/**
 * Applique une division à une liste de segments
 * Remplace le segment original par les deux nouveaux segments
 * @param segments Liste originale de segments
 * @param splitResult Résultat de splitSegment
 * @param originalSegmentId ID du segment original
 * @returns Nouvelle liste de segments
 */
export function applySplitToSegments(
  segments: TimelineSegment[],
  splitResult: [TimelineSegment, TimelineSegment],
  originalSegmentId: string
): TimelineSegment[] {
  return segments.flatMap(segment => {
    if (segment.id === originalSegmentId) {
      return splitResult;
    }
    return segment;
  });
}

/**
 * Applique une fusion à une liste de segments
 * Remplace les deux segments originaux par le segment fusionné
 * @param segments Liste originale de segments
 * @param mergedSegment Segment fusionné
 * @param segmentId1 ID du premier segment
 * @param segmentId2 ID du deuxième segment
 * @returns Nouvelle liste de segments
 */
export function applyMergeToSegments(
  segments: TimelineSegment[],
  mergedSegment: TimelineSegment,
  segmentId1: string,
  segmentId2: string
): TimelineSegment[] {
  return segments.filter(segment => 
    segment.id !== segmentId1 && segment.id !== segmentId2
  ).concat(mergedSegment);
}