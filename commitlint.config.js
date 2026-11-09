export default {
  extends: ['@commitlint/config-conventional'],
  // Dependabot writes "Bump <package> from 1.0.0 to 2.0.0" for NuGet, which
  // is not a Conventional Commit, and the bot cannot be told to use the
  // subject case this project requires. Rewriting the bot's history is not
  // worth it, so commits signed off by it are exempt. Merge commits are
  // already exempt by the default ignore list.
  ignores: [(message) => message.includes('Signed-off-by: dependabot[bot]')],
}
