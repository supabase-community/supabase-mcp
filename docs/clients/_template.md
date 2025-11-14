<details>
<summary>{{label}}</summary>

{{#if deeplinks}}
#### Click the button to install:

{{#each deeplinks}}
[<img src="{{buttonImage}}" alt="{{buttonAlt}}">]({{url}}){{#unless @last}} {{/unless}}
{{/each}}

{{/if}}
{{#if commandInstructions}}
#### Install via command line:

{{#if commandInstructions.prerequisite}}
{{{commandInstructions.prerequisite}}}

{{/if}}
{{{commandInstructions.command}}}

{{#if commandInstructions.followUp}}
{{#each commandInstructions.followUp}}
{{{this}}}

{{/each}}
{{/if}}
{{/if}}
{{#if manualConfig}}
#### Or install manually:

Open (or create) your `{{manualConfig.configFilePath}}` file and add:

```{{#if (eq configFormat "yaml-goose")}}yaml{{else}}json{{/if}}
{{{manualConfig.snippet}}}
```

{{/if}}
{{#if officialDocsUrl}}
For more information, see the [{{label}} MCP docs]({{officialDocsUrl}}).
{{/if}}

</details>
