// Real Supabase Storage integration for Documents (2026-09-04). Shared test-cleanup helper —
// every verification script that seeds/creates real objects in the `documents` bucket under a
// test client's own `<clientId>/uploads/...` or `<clientId>/published/...` folders needs to
// remove them again at the end, the same way every other test cleans up its own rows. Object
// paths under a client's folder are only ever known in advance for objects a test itself
// uploaded with a literal path; a real Upload/Publish action driven through the actual UI
// generates its own docId-based path client-side (or server-side, for publish-document), which
// no test script can predict ahead of time. A recursive list-then-remove is the only reliable
// way to guarantee a clean bucket afterward regardless of which paths ended up real.
//
// Confirmed directly against the real local Storage API before relying on this (not assumed):
// `list(path)` returns FOLDER entries with `id: null` and FILE entries with real metadata
// (`id`, `metadata.size`, etc.) — this walks exactly two levels deep
// (`<clientId>/<uploads|published>/<docId>/<filename>`), matching the one, single storage path
// convention this feature ever produces (see the storage migration's own header for the
// convention itself).
export async function removeAllClientStorageObjects(admin, bucket, clientId) {
  const removedPaths = [];
  for (const subfolder of ['uploads', 'published']) {
    const { data: docFolders } = await admin.storage.from(bucket).list(clientId + '/' + subfolder);
    if (!docFolders || docFolders.length === 0) continue;
    for (const folderEntry of docFolders) {
      const docPath = clientId + '/' + subfolder + '/' + folderEntry.name;
      const { data: files } = await admin.storage.from(bucket).list(docPath);
      if (!files) continue;
      for (const fileEntry of files) {
        removedPaths.push(docPath + '/' + fileEntry.name);
      }
    }
  }
  if (removedPaths.length > 0) {
    await admin.storage.from(bucket).remove(removedPaths);
  }
  return removedPaths;
}
