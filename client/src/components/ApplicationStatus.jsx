import { useTranslation } from 'react-i18next';
import { formatDate } from '../i18n';

export function StatusBadge({ status }) {
  const { t } = useTranslation();
  return <span className={`badge badge-${status}`}>{t(`status.${status}`)}</span>;
}

// FR-3c: the applicant sees where the application stands, the admin's reason, and the history.
export default function ApplicationStatus({ application }) {
  const { t } = useTranslation();
  return (
    <div className="card">
      <p><strong>{t('apply.status')}:</strong> <StatusBadge status={application.status} /></p>
      {application.reason && <p className="notice"><strong>{t('apply.adminReason')}:</strong> {application.reason}</p>}
      {application.history?.length > 0 && (
        <>
          <h3>{t('apply.history')}</h3>
          <ul className="timeline">
            {application.history.map((h, i) => (
              <li key={i}>
                <strong>{t(`action.${h.action}`)}</strong> <span className="muted">· {formatDate(h.createdAt)}</span>
                {h.reason && <div className="muted">{h.reason}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
