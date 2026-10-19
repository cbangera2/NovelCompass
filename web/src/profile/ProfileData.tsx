import { Download, ExternalLink, FileUp, ShieldCheck, Trash2 } from 'lucide-react';
import { Card } from '../design-system';
import { clearLocalProfile } from './store';
import { downloadProfileBackup } from './transfer';
import { ListPagesImport, useImportedLists } from './ListPagesImport';
import { ProfileImportDialog } from './ProfileImportDialog';
import type { LocalUserProfile } from './types';

export function ProfileData({
  profile,
  onProfileChange,
}: {
  profile: LocalUserProfile;
  onProfileChange: (profile: LocalUserProfile | null) => void;
}): JSX.Element {
  const importedLists = useImportedLists();

  const clear = async () => {
    if (!window.confirm('Delete the complete local profile from this browser?')) return;
    await clearLocalProfile();
    onProfileChange(null);
  };

  return (
    <>
      <Card className="profile-control-strip">
        <div><ShieldCheck size={18} /><span><strong>Private local profile</strong><small>Normalized data stays in IndexedDB on this browser.</small></span></div>
        <div className="profile-data-actions">
          <ProfileImportDialog profile={profile} triggerClassName="profile-data-button profile-data-primary" trigger={<><FileUp size={15} aria-hidden="true" /> Import or merge files</>} />
          <button type="button" className="profile-data-button" onClick={() => downloadProfileBackup(profile)}><Download size={15} /> Export JSON</button>
          <button type="button" className="profile-data-button profile-data-danger" onClick={clear}><Trash2 size={15} /> Delete profile</button>
        </div>
      </Card>

      <Card className="profile-lists-section">
        <div className="profile-library-heading">
          <div><span className="eyebrow">Saved metadata</span><h2>Created lists</h2></div>
          <span>{profile.curated_lists.length} summaries</span>
        </div>
        <p className="profile-list-note">Your saved profile page only lists each list's title. Add the saved pages of the lists themselves to use their titles as taste signals on the For You page.</p>
        <ListPagesImport onImported={importedLists.refresh} disabled={!importedLists.available} />
        {!importedLists.available && <p className="profile-list-note">Importing needs the live API (the uvicorn server) to be running.</p>}
        <div className="profile-list-grid">
          {profile.curated_lists.map((list) => (
            <article key={list.id}>
              <div><h3>{list.title}</h3>{list.is_private && <span>Private</span>}</div>
              {list.description && <p>{list.description}</p>}
              <footer>
                <span>
                  {importedLists.counts.has(list.id)
                    ? `${importedLists.counts.get(list.id)} titles imported`
                    : list.series_count != null ? `${list.series_count} series · not imported` : 'Not imported'}
                </span>
                {!list.is_private && <a href={`https://www.novelupdates.com/viewlist/${list.id}/`} target="_blank" rel="noopener noreferrer">View summary source <ExternalLink size={13} /></a>}
              </footer>
            </article>
          ))}
        </div>
      </Card>
    </>
  );
}
