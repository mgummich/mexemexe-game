# 13 — Online Lobby / Multiplayer Trust

Goal: make online state trustworthy and social: players always know connection, waiting, ownership, timer and recovery state.

- **ONLINE-01** Keep entry simple: `CRIAR SALA` and code join; hide networking terminology.
- **ONLINE-02** Make room code the hero after creation; provide `COPIAR CÓDIGO` and `COMPARTILHAR`.
- **ONLINE-03** Add deep/share room links if routing supports it cleanly, pre-filling room join.
- **ONLINE-04** Present occupied seats around a table rather than only a generic list where practical.
- **ONLINE-05** Make ready/not-ready state unmistakable without color alone.
- **ONLINE-06** If Start is blocked, state exactly who is still not ready.
- **ONLINE-07** Make host ownership explicit; guests see read-only setting text, not controls that merely look broken.
- **ONLINE-08** Present timer presets as experiences first and numbers second.
- **ONLINE-09** Explain one-per-turn Mexe time extension before play and visibly show the extension when granted.
- **ONLINE-10** Keep healthy connection status quiet; promote Connecting/Reconnecting/Offline only.
- **ONLINE-11** On reconnect after an unsubmitted draft loss, explicitly explain that the table returned to last confirmed state.
- **ONLINE-12** Freeze interaction during reconnect/resync so players do not build unsendable drafts.
- **ONLINE-13** Name disconnected/reconnected players in messages.
- **ONLINE-14** Explain automatic draw/end-turn after disconnect grace expires and warn about repeated missed-turn consequences.
- **ONLINE-15** Make timer warning/critical states progressively visible without covering the puzzle.
- **ONLINE-16** When time expires, explain the resulting server action rather than silently changing turn.
- **ONLINE-17** Give FEITO a pending state such as `ENVIANDO...`; visually prevent double-submit.
- **ONLINE-18** Translate server rejection codes into human, action-oriented explanations.
- **ONLINE-19** Present desync recovery as `ATUALIZANDO A MESA...`, not technical terminology.
- **ONLINE-20** Online menu overlays must show that the match/timer continues if true.
- **ONLINE-21** Prefer safe preset reactions/emotes with cooldowns before adding full chat.
- **ONLINE-22** Keep display names visually stable/important; later add lightweight avatar identity if desired.
- **ONLINE-23** Add online rematch/persistent social table so a group can continue without recreating the room manually.
- **ONLINE-24** Desired lifecycle: Lobby → Game → Results → Rematch Ready → Game. If backend persistence is difficult, hide successor-room recreation behind the same UX.
- **ONLINE-25** Add compact public winning-move summary data so online results can explain how the winner finished without exposing private info.

Verification: host/guest, ready states, reconnect during normal turn and draft, timeout, rejection, resync, room sharing, rematch, mobile.
