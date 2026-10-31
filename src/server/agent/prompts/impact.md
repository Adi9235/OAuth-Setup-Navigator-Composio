A documentation page that an OAuth setup guide relies on has changed. Decide which of the guide's
claims the change affects.

Page: {{url}}

Changed text (lines starting with "-" were removed, "+" were added):
<<<
{{diff}}
>>>

Claims that cite this page:
{{claims}}

Return JSON: { "impact": "none"|"minor"|"breaking", "affectedClaimIds": string[], "summary": <one sentence describing what changed> }

- "none": wording/layout/navigation changes; no claim's meaning is touched.
- "minor": a detail relevant to a claim changed but the setup path is the same.
- "breaking": a requirement, review rule, step, or limit that a claim states has changed or been removed.
- List a claim id only if the changed text is about what that claim says.
