import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ANALYTICS_LOAD_ERROR,
  fetchAnalyticsClients,
  fetchClientAnalytics,
} from '../services/analyticsService';
import type {
  AnalyticsClientOption,
  AnalyticsDateRangeKey,
  ClientAnalyticsReport,
} from '../types/analytics';

type ClientListStatus = 'loading' | 'success' | 'error';
type AnalyticsStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseAnalyticsResult {
  clients: AnalyticsClientOption[];
  clientListStatus: ClientListStatus;
  clientListError: string | null;
  selectedClientId: string | null;
  selectedClient: AnalyticsClientOption | null;
  rangeKey: AnalyticsDateRangeKey;
  report: ClientAnalyticsReport | null;
  analyticsStatus: AnalyticsStatus;
  analyticsError: string | null;
  selectClient: (clientId: string | null) => void;
  selectRange: (rangeKey: AnalyticsDateRangeKey) => void;
  retryClients: () => Promise<void>;
  retryAnalytics: () => Promise<void>;
}

const userMessageFrom = (cause: unknown): string => {
  if (
    cause
    && typeof cause === 'object'
    && 'userMessage' in cause
    && typeof cause.userMessage === 'string'
  ) {
    return cause.userMessage;
  }
  return ANALYTICS_LOAD_ERROR;
};

export const useAnalytics = (): UseAnalyticsResult => {
  const [clients, setClients] = useState<AnalyticsClientOption[]>([]);
  const [clientListStatus, setClientListStatus] = useState<ClientListStatus>('loading');
  const [clientListError, setClientListError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [rangeKey, setRangeKey] = useState<AnalyticsDateRangeKey>('30d');
  const [report, setReport] = useState<ClientAnalyticsReport | null>(null);
  const [analyticsStatus, setAnalyticsStatus] = useState<AnalyticsStatus>('idle');
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const clientRequestGeneration = useRef(0);
  const analyticsRequestGeneration = useRef(0);

  const loadClients = useCallback(async (): Promise<void> => {
    const generation = ++clientRequestGeneration.current;
    setClientListStatus('loading');
    setClientListError(null);

    const result = await fetchAnalyticsClients();
    if (generation !== clientRequestGeneration.current) return;

    if (result.status === 'error') {
      setClients([]);
      setClientListStatus('error');
      setClientListError(result.userMessage);
      return;
    }

    setClients(result.clients);
    setSelectedClientId((current) => (
      current !== null && result.clients.some((client) => client.id === current) ? current : null
    ));
    setClientListStatus('success');
  }, []);

  const loadAnalytics = useCallback(async (): Promise<void> => {
    const generation = ++analyticsRequestGeneration.current;
    if (selectedClientId === null) {
      setReport(null);
      setAnalyticsStatus('idle');
      setAnalyticsError(null);
      return;
    }

    setReport(null);
    setAnalyticsStatus('loading');
    setAnalyticsError(null);

    try {
      const nextReport = await fetchClientAnalytics(selectedClientId, rangeKey);
      if (generation !== analyticsRequestGeneration.current) return;
      setReport(nextReport);
      setAnalyticsStatus('success');
    } catch (cause) {
      if (generation !== analyticsRequestGeneration.current) return;
      setReport(null);
      setAnalyticsStatus('error');
      setAnalyticsError(userMessageFrom(cause));
    }
  }, [rangeKey, selectedClientId]);

  useEffect(() => {
    void loadClients();
    return () => {
      clientRequestGeneration.current += 1;
    };
  }, [loadClients]);

  useEffect(() => {
    void loadAnalytics();
    return () => {
      analyticsRequestGeneration.current += 1;
    };
  }, [loadAnalytics]);

  const selectClient = useCallback((clientId: string | null) => {
    analyticsRequestGeneration.current += 1;
    setReport(null);
    setAnalyticsError(null);
    setAnalyticsStatus(clientId === null ? 'idle' : 'loading');
    setSelectedClientId(clientId);
  }, []);

  const selectRange = useCallback((nextRangeKey: AnalyticsDateRangeKey) => {
    if (nextRangeKey === rangeKey) return;
    analyticsRequestGeneration.current += 1;
    setReport(null);
    setAnalyticsError(null);
    setAnalyticsStatus(selectedClientId === null ? 'idle' : 'loading');
    setRangeKey(nextRangeKey);
  }, [rangeKey, selectedClientId]);

  return {
    clients,
    clientListStatus,
    clientListError,
    selectedClientId,
    selectedClient: clients.find((client) => client.id === selectedClientId) ?? null,
    rangeKey,
    report,
    analyticsStatus,
    analyticsError,
    selectClient,
    selectRange,
    retryClients: loadClients,
    retryAnalytics: loadAnalytics,
  };
};
