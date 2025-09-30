-- Aggiorna Ordinal di utenti non registrati (che hanno UserId come ordinale)
UPDATE `MatchParticipants`
SET Ordinal = CAST(`UserId` AS UNSIGNED)
WHERE `Ordinal` IS NULL AND `Registered` = 0
;

-- Imposta a null UserId per utenti non registrati (rimuove vecchio ordinale)
UPDATE `MatchParticipants`
SET UserId = NULL
WHERE `Registered` = 0
;

-- Visualizza nuovi ordinali generati per record di utenti registrati
SELECT
	mp.SessionId,
	mp.MatchId,
	mp.Ordinal,
	mp.UserId,
	ROW_NUMBER() OVER (PARTITION BY SessionId, MatchId ORDER BY UserId) AS NewOrdinal,
	(SELECT MAX(Ordinal) FROM `MatchParticipants` AS submp WHERE submp.SessionId = mp.SessionId AND submp.MatchId = mp.MatchId) AS BaseOrdinal
FROM `MatchParticipants` AS mp
WHERE Registered = 1
;

-- Memorizza nuovi ordinali generati
CREATE TEMPORARY TABLE src SELECT
	mp.SessionId,
	mp.MatchId,
	mp.UserId,
	ROW_NUMBER() OVER (PARTITION BY SessionId, MatchId ORDER BY UserId) AS AddOrdinal,
	COALESCE((SELECT MAX(Ordinal) FROM `MatchParticipants` AS submp WHERE submp.SessionId = mp.SessionId AND submp.MatchId = mp.MatchId), 0) AS BaseOrdinal
FROM `MatchParticipants` AS mp
WHERE mp.Registered = 1;

UPDATE `MatchParticipants` AS mp
SET Ordinal = (SELECT BaseOrdinal + AddOrdinal FROM src WHERE mp.SessionId = `src`.SessionId AND mp.MatchId = `src`.MatchId AND mp.UserId = `src`.UserId)
WHERE mp.Registered = 1;
