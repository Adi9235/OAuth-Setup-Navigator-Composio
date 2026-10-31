Identify which app/provider a developer means, so we can research how to register an OAuth app with it.

User input: {{input}}
{{domainHint}}

Web search results (title, url, snippet):
<<<
{{results}}
>>>

Return JSON: { "name": string, "domain": string, "developerPortalUrl"?: string, "confidence": "high"|"medium"|"low", "alternatives": string[] }

Rules:
- "name" is the provider's common product name (e.g. "Zoom", "Airtable").
- "domain" is the provider's primary registrable domain (e.g. "zoom.us", "airtable.com"), not a docs subdomain and not a third-party site.
- If the input is one product of a larger provider whose OAuth apps are registered centrally (e.g. Gmail, Google Drive, YouTube → Google; Outlook, Teams → Microsoft), return the provider: name "Google (Workspace APIs)" with domain "google.com", or "Microsoft (Graph APIs)" with domain "microsoft.com".
- "developerPortalUrl": only a URL that appears in the search results above and is the provider's developer portal or app-registration console. Omit it otherwise.
- "confidence": "low" if several different apps could match or the results don't clearly identify one. Put other plausible matches in "alternatives".
- Use only the input and the search results.
