<details>
<summary>{{name}}</summary>

{{#if installation.deeplink}}
#### Click the button to install:

{{#each installation.deeplink}}
[<img src="{{buttonImage}}" alt="{{buttonAlt}}">]({{url}}){{#unless @last}} {{/unless}}
{{/each}}

{{/if}}
{{#if installation.command}}
#### Install via command line:

```bash
{{installation.command.command}}
```

{{#if installation.command.description}}
{{installation.command.description}}

{{/if}}
{{/if}}
#### Or install manually:

Open (or create) your `{{installation.manual.configFilePath}}` file and add:

```json
{{#if (eq installation.manual.configFormat "mcpServers")}}
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp"
    }
  }
}
{{else if (eq installation.manual.configFormat "servers")}}
{
  "servers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp"
    }
  }
}
{{else}}
{
  "supabase": {
    "type": "http",
    "url": "https://mcp.supabase.com/mcp"
  }
}
{{/if}}
```

{{#if officialDocs}}
For more information, see the [{{name}} MCP docs]({{officialDocs}}).
{{/if}}

</details>
