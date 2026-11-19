import { useTranslation } from 'react-i18next';

export default function ComingSoon() {
  const { t } = useTranslation();
  return <div className="card center"><h2>{t('home.comingSoonTitle')}</h2><p className="muted">{t('home.comingSoon')}</p></div>;
}
