## From development to production

After releasing your app to the world, we recommend creating a development branch for working on new features and bug fixes.

Using a development branch, you can safely experiment with schema changes while minimizing the risk of data loss, downtime, or compatibility issues between your app and production database.

### Create a development branch

Simply ask the LLM to "create a development branch", and it will invoke the `create_branch` MCP tool.

The development branch clones your production branch by applying the same migrations shown by `list_migrations` tool. It does not include any untracked data or schema changes that came directly from users interacting with your app.

Depending on the size of your migrations, your development branch may take up to a few minutes to setup. You can ask the LLM to check the branch status periodically using the `list_branches` tool. 

### Create a new migration

Once your development branch is ready, you can start building new features by invoking the `apply_migration` tool. This tool tracks any schema or data changes as a migration so that it can be replayed on your production branch when you are ready to deploy.

When creating a migration that inserts static data, it is important to ask the LLM to avoid hardcoding foreign key references. Foreign keys are tied specifically to the data in your development branch so any migration relying on that will fail when applied to the production branch.

When creating a destructive migration like dropping a column, you must review the generated SQL statements and the current state of your database to confirm that the data loss is expected and acceptable.

After successfully applying a migration, you can test your database changes by connecting your app to the development branch. The branch project URL and API keys can be fetched using `get_project_url` and `get_anon_key` tools respectively. Save them in your `.env` file to avoid repeating this in the future.

### Revert a migration

If you have discovered any issues during testing and want to revert a migration, simply ask the LLM to reset the last `n` migrations or by specifying a specific version number, like `20250401000000`. You can find the version numbers used for previous migrations by asking the LLM to list migrations (`list_migrations` tool). You will be prompted to invoke the `reset_branch` tool to revert the development branch back to the specified migration version.

The reset process may take up to a few minutes to complete depending on the size of your migrations. Once it's ready, the branch status will be updated to `FUNCTIONS_DEPLOYED` so that the LLM is aware. All untracked data and schema changes will be cleared by the reset.

If you want to rollback a migration that has already been applied on the production branch, do not use the `reset_branch` tool. Instead, ask the LLM to create a new migration that reverts changes made in a prior migration. This ensures that your migrations on production branch are always rolling forward without causing compatibility issues with your development branch.

### Merge to production

Now that you are done developing your new feature, it is time to merge it back to the production branch. You can do that by invoking the `merge_branch` tool.

Merging a development branch is equivalent to applying new migrations incrementally on the production branch. Since these migrations have been tested and verified on your development branch, they are generally safe to execute on your production data.

If you encounter any errors during the merge, the production branch status will be updated to `MIGRATIONS_FAILED`. You can ask the LLM to lookup the exact error for this branch action using the `get_logs` tool. To fix these errors, you must follow these steps.

1. Reset the problematic migration from your development branch.
2. Apply a new migration with the fix on your development branch.
3. Merge the development branch to production.

Only successful migrations are tracked so it is safe to merge the same development branch multiple times.

### Delete a development branch

Finally, after merging all changes to production, you can delete the development branch using the `delete_branch` tool. This helps you save on resources as any active development branch will be billed at $0.01344 per hour.

### Rebase a development branch

Sometimes it is unavoidable to apply a hotfix migration on your production database directly. As a result, your development branch may be behind your production branch in terms of migration versions.

Similarly, if you are working in a team where each member works on a separate development branch, merging branches in different order could also result in migration drift.

To fix this problem, you can either recreate your development branch or invoke the `rebase_branch` tool. This tool incrementally applies new migrations from the production branch back on to the development branch.

### Conclusion

To summarise our workflow using development and production branches, we expose 3 core tools for managing migrations.

1. `rebase_branch`: This tool brings the development branch in sync with the production branch, covering cases where production is ahead of development. Creating a new development branch runs this tool implicitly. If you use multiple development branches, merging branch A after creating branch B could also result in migration drift. You can run rebase on branch B to recover from drift.

2. `merge_branch`: This tool brings production in sync with development, covering cases where development is ahead of production. Running this tool will apply new migrations from development to the production branch. Any failures should be resolved on the development branch before retrying.

3. `reset_branch`: This tool is an escape hatch to cover all other cases where migrations are different between production and development. By default it resets the development branch to the latest migration, dropping any untracked tables and data. You can also specify a prior migration version to revert a migration that's already applied on development. A version of 0 will reset the development to a fresh database.

Mastering this workflow goes a long way to ensure your production app is always ready when you release new features and bug fixes.
