# Cloudflare deployment checklist

1. Create a Cloudflare account, enable R2, and run `npx wrangler login` locally.
2. Create the `hoggertype-simc-runtime` R2 bucket. No public bucket access or
   `r2.dev` development URL is needed.
3. Commit source changes and build a release using the README commands.
4. Upload the release with `npm run publish:r2`, then `npm run deploy:host`.
5. Verify the hosted `frame.html`, JavaScript, WASM, metadata, and source archive.
   Test a real cast from the frontend against the HTTPS runtime URL.
6. Run `npm run promote:stable` after publication and host deployment. It verifies
   the immutable release before atomically updating the stable redirect.
7. Configure `NEXT_PUBLIC_SIMC_RUNTIME_URL` on the frontend deployment once to
   `https://<worker-address>/stable/frame.html`. Use an immutable release URL
   instead when intentionally pinning a specific build.

For GitHub Actions, create a dedicated Cloudflare API token scoped to the
deployment account, with Workers Scripts edit, Workers R2 Storage edit, and
Account Settings read permissions. Add it as repository secret
`CLOUDFLARE_API_TOKEN`; add the account ID as variable `CLOUDFLARE_ACCOUNT_ID`.
Set variable `RUNTIME_BASE_URL` to the Worker's HTTPS origin for post-deployment
checksum checks. The workflow checks both the first download and a cache hit.
Use the account dashboard's current permission labels when creating the token.
Set these on the public runtime repository, not the private frontend repository.

The workflow runs for pushes to `main` or manual dispatch. Its build tool and
action versions are pinned. It verifies startup for every supported profile,
packages corresponding source and file checksums, and deploys only when the
account variable is configured. No frontend code or credentials are uploaded
as runtime artifacts.

If a deployment fails midway through upload, the prior production URL stays
valid. Correct the failure and rerun publication for the same artifact set.
To roll back stable, run `npm run promote:stable -- <older-release-id>`.
