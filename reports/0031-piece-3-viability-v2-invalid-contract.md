# Piece 3 viability v2 — invalid tool contract

The corrected-search v2 run completed for $0.04438764, but its result is not accepted as evidence about candidate quality.

All five candidates failed at the same hidden tool-code boundary. The knowledge article returned `howto-answered`, and candidates reasonably used that code when closing the ticket, but the host silently required `howto-resolved`. Candidates also used the semantically reasonable `active-incident` response while the host silently required `known-incident`.

These were undocumented enum requirements. Rejecting candidates for values that the tool contract did not expose is an invalid evaluation.

The v3 tool definitions now publish and schema-enforce exact allowed values. Knowledge results separately return a response code and closure code. V2 remains preserved, its spend remains in the cumulative ledger, and none of its failures will be used as compiler evidence. Unseen cases remained sealed.
