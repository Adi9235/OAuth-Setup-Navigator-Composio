Check whether each claim is supported by the source text. Judge every claim independently.

Source URL: {{url}}
Source text:
<<<
{{section}}
>>>

Claims:
{{claims}}

Return JSON: { "results": [ { "id": <claim id>, "verdict": "supported"|"partially"|"unsupported",
"correctedText"?: <claim rewritten to match the source exactly, only if partially>,
"reason": <one sentence> } ] }
Return one result per claim id.

"supported" = the source states this directly. "partially" = the source supports a narrower or
different version. "unsupported" = the source doesn't say this. Be strict: inferences, generalizations,
and numbers not in the text are not supported.
