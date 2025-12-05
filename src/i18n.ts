// Simple i18n system for ARMGDDN Downloader

export type Language = 'en' | 'es' | 'fr' | 'de' | 'pt';

interface Translations {
  [key: string]: {
    [lang in Language]: string;
  };
}

const translations: Translations = {
  // Header
  'app.title': {
    en: 'ARMGDDN Downloader',
    es: 'Descargador ARMGDDN',
    fr: 'Téléchargeur ARMGDDN',
    de: 'ARMGDDN Downloader',
    pt: 'Baixador ARMGDDN',
  },
  'header.history': {
    en: 'History',
    es: 'Historial',
    fr: 'Historique',
    de: 'Verlauf',
    pt: 'Histórico',
  },
  'header.checkUpdates': {
    en: 'Check for Updates',
    es: 'Buscar Actualizaciones',
    fr: 'Vérifier les Mises à Jour',
    de: 'Nach Updates Suchen',
    pt: 'Verificar Atualizações',
  },
  'header.settings': {
    en: 'Settings',
    es: 'Configuración',
    fr: 'Paramètres',
    de: 'Einstellungen',
    pt: 'Configurações',
  },
  
  // Manifest input
  'manifest.placeholder': {
    en: 'Enter manifest URL from ARMGDDN Browser...',
    es: 'Ingrese URL del manifiesto desde ARMGDDN Browser...',
    fr: 'Entrez l\'URL du manifeste depuis ARMGDDN Browser...',
    de: 'Manifest-URL von ARMGDDN Browser eingeben...',
    pt: 'Digite a URL do manifesto do ARMGDDN Browser...',
  },
  'manifest.fetch': {
    en: 'Fetch Downloads',
    es: 'Obtener Descargas',
    fr: 'Récupérer les Téléchargements',
    de: 'Downloads Abrufen',
    pt: 'Buscar Downloads',
  },
  
  // Download states
  'state.queued': {
    en: 'queued',
    es: 'en cola',
    fr: 'en attente',
    de: 'in Warteschlange',
    pt: 'na fila',
  },
  'state.scheduled': {
    en: 'scheduled',
    es: 'programado',
    fr: 'planifié',
    de: 'geplant',
    pt: 'agendado',
  },
  'state.downloading': {
    en: 'downloading',
    es: 'descargando',
    fr: 'téléchargement',
    de: 'wird heruntergeladen',
    pt: 'baixando',
  },
  'state.paused': {
    en: 'paused',
    es: 'pausado',
    fr: 'en pause',
    de: 'pausiert',
    pt: 'pausado',
  },
  'state.completed': {
    en: 'completed',
    es: 'completado',
    fr: 'terminé',
    de: 'abgeschlossen',
    pt: 'concluído',
  },
  'state.failed': {
    en: 'failed',
    es: 'fallido',
    fr: 'échoué',
    de: 'fehlgeschlagen',
    pt: 'falhou',
  },
  'state.cancelled': {
    en: 'cancelled',
    es: 'cancelado',
    fr: 'annulé',
    de: 'abgebrochen',
    pt: 'cancelado',
  },
  
  // Actions
  'action.pause': {
    en: 'Pause',
    es: 'Pausar',
    fr: 'Pause',
    de: 'Pausieren',
    pt: 'Pausar',
  },
  'action.resume': {
    en: 'Resume',
    es: 'Reanudar',
    fr: 'Reprendre',
    de: 'Fortsetzen',
    pt: 'Retomar',
  },
  'action.start': {
    en: 'Start',
    es: 'Iniciar',
    fr: 'Démarrer',
    de: 'Starten',
    pt: 'Iniciar',
  },
  'action.startNow': {
    en: 'Start Now',
    es: 'Iniciar Ahora',
    fr: 'Démarrer Maintenant',
    de: 'Jetzt Starten',
    pt: 'Iniciar Agora',
  },
  'action.cancel': {
    en: 'Cancel',
    es: 'Cancelar',
    fr: 'Annuler',
    de: 'Abbrechen',
    pt: 'Cancelar',
  },
  'action.retry': {
    en: 'Retry',
    es: 'Reintentar',
    fr: 'Réessayer',
    de: 'Wiederholen',
    pt: 'Tentar Novamente',
  },
  'action.remove': {
    en: 'Remove',
    es: 'Eliminar',
    fr: 'Supprimer',
    de: 'Entfernen',
    pt: 'Remover',
  },
  
  // Settings
  'settings.title': {
    en: 'Settings',
    es: 'Configuración',
    fr: 'Paramètres',
    de: 'Einstellungen',
    pt: 'Configurações',
  },
  'settings.downloadLocation': {
    en: 'Download Location',
    es: 'Ubicación de Descarga',
    fr: 'Emplacement de Téléchargement',
    de: 'Download-Speicherort',
    pt: 'Local de Download',
  },
  'settings.maxConcurrent': {
    en: 'Max Concurrent Downloads',
    es: 'Descargas Simultáneas Máximas',
    fr: 'Téléchargements Simultanés Max',
    de: 'Max. Gleichzeitige Downloads',
    pt: 'Downloads Simultâneos Máximos',
  },
  'settings.authToken': {
    en: 'Authentication Token (optional)',
    es: 'Token de Autenticación (opcional)',
    fr: 'Jeton d\'Authentification (optionnel)',
    de: 'Authentifizierungstoken (optional)',
    pt: 'Token de Autenticação (opcional)',
  },
  'settings.language': {
    en: 'Language',
    es: 'Idioma',
    fr: 'Langue',
    de: 'Sprache',
    pt: 'Idioma',
  },
  'settings.save': {
    en: 'Save Settings',
    es: 'Guardar Configuración',
    fr: 'Enregistrer les Paramètres',
    de: 'Einstellungen Speichern',
    pt: 'Salvar Configurações',
  },
  
  // History
  'history.title': {
    en: 'Download History',
    es: 'Historial de Descargas',
    fr: 'Historique des Téléchargements',
    de: 'Download-Verlauf',
    pt: 'Histórico de Downloads',
  },
  'history.clear': {
    en: 'Clear History',
    es: 'Limpiar Historial',
    fr: 'Effacer l\'Historique',
    de: 'Verlauf Löschen',
    pt: 'Limpar Histórico',
  },
  'history.empty': {
    en: 'No download history yet.',
    es: 'Aún no hay historial de descargas.',
    fr: 'Aucun historique de téléchargement pour le moment.',
    de: 'Noch kein Download-Verlauf.',
    pt: 'Nenhum histórico de download ainda.',
  },
  'history.confirmClear': {
    en: 'Are you sure you want to clear all download history?',
    es: '¿Está seguro de que desea borrar todo el historial de descargas?',
    fr: 'Êtes-vous sûr de vouloir effacer tout l\'historique des téléchargements?',
    de: 'Möchten Sie wirklich den gesamten Download-Verlauf löschen?',
    pt: 'Tem certeza de que deseja limpar todo o histórico de downloads?',
  },
  
  // Empty states
  'downloads.empty': {
    en: 'No downloads yet. Add a manifest URL above to get started.',
    es: 'Aún no hay descargas. Agregue una URL de manifiesto arriba para comenzar.',
    fr: 'Aucun téléchargement pour le moment. Ajoutez une URL de manifeste ci-dessus pour commencer.',
    de: 'Noch keine Downloads. Fügen Sie oben eine Manifest-URL hinzu, um zu beginnen.',
    pt: 'Nenhum download ainda. Adicione uma URL de manifesto acima para começar.',
  },
  
  // Notifications
  'notification.downloadComplete': {
    en: 'Download Complete!',
    es: '¡Descarga Completada!',
    fr: 'Téléchargement Terminé!',
    de: 'Download Abgeschlossen!',
    pt: 'Download Concluído!',
  },
  'notification.updateAvailable': {
    en: 'Update Available',
    es: 'Actualización Disponible',
    fr: 'Mise à Jour Disponible',
    de: 'Update Verfügbar',
    pt: 'Atualização Disponível',
  },
  'notification.upToDate': {
    en: 'You\'re already running the latest version!',
    es: '¡Ya está ejecutando la última versión!',
    fr: 'Vous utilisez déjà la dernière version!',
    de: 'Sie verwenden bereits die neueste Version!',
    pt: 'Você já está executando a versão mais recente!',
  },
};

let currentLanguage: Language = 'en';

export function setLanguage(lang: Language) {
  currentLanguage = lang;
  localStorage.setItem('language', lang);
}

export function getLanguage(): Language {
  const saved = localStorage.getItem('language') as Language;
  return saved || 'en';
}

export function t(key: string): string {
  const translation = translations[key];
  if (!translation) {
    console.warn(`Missing translation for key: ${key}`);
    return key;
  }
  return translation[currentLanguage] || translation.en;
}

// Initialize language from localStorage
currentLanguage = getLanguage();
