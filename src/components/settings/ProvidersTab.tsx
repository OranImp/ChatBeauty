import React, { Suspense, lazy, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store/useAppStore';
import {
  benchmarkProviderEndpoint,
  type EndpointBenchmarkResult,
} from '@/services/llm/endpointBenchmark';
import type { ProviderConfig } from '@/types/chat';
import { GenerationTab } from './GenerationTab';
import { ProviderListView } from './ProviderListView';
import { ProviderEditorView } from './ProviderEditorView';
import { getProviderUrlKey } from './providerShared';

const LazyProviderWizard = lazy(() =>
  import('./ProviderWizard').then((m) => ({ default: m.ProviderWizard }))
);

interface ProvidersTabProps {
  section?: 'providers' | 'generation';
}

export const ProvidersTab: React.FC<ProvidersTabProps> = ({ section = 'providers' }) => {
  const {
    providers,
    activeProviderId,
    activeModelId,
    modelProfileSync,
    saveProvider,
    deleteProvider,
    setActiveProviderModel,
    fetchProviderModels,
    testProviderConnection,
  } = useAppStore(
    useShallow((s) => ({
      providers: s.providers,
      activeProviderId: s.activeProviderId,
      activeModelId: s.activeModelId,
      modelProfileSync: s.modelProfileSync,
      saveProvider: s.saveProvider,
      deleteProvider: s.deleteProvider,
      setActiveProviderModel: s.setActiveProviderModel,
      fetchProviderModels: s.fetchProviderModels,
      testProviderConnection: s.testProviderConnection,
    }))
  );

  const [view, setView] = useState<'list' | 'wizard' | 'edit'>('list');
  const [prevView, setPrevView] = useState<'list' | 'wizard' | 'edit'>('list');
  const [viewAnim, setViewAnim] = useState<
    'cb-panel-enter' | 'cb-step-forward' | 'cb-step-backward'
  >('cb-panel-enter');
  if (view !== prevView) {
    setPrevView(view);
    setViewAnim(view === 'list' ? 'cb-step-backward' : 'cb-step-forward');
  }
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [benchmarkByUrl, setBenchmarkByUrl] = useState<Record<string, EndpointBenchmarkResult>>({});
  const [benchmarkingUrls, setBenchmarkingUrls] = useState<Record<string, boolean>>({});

  if (section === 'generation') {
    return <GenerationTab />;
  }

  const handleBenchmarkEndpoint = async (p: ProviderConfig, urlOverride?: string) => {
    const key = getProviderUrlKey(p, urlOverride);
    setBenchmarkingUrls((prev) => ({ ...prev, [key]: true }));
    try {
      const result = await benchmarkProviderEndpoint(p, urlOverride);
      setBenchmarkByUrl((prev) => ({ ...prev, [key]: result }));
      return result;
    } finally {
      setBenchmarkingUrls((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleWizardComplete = async (created: ProviderConfig) => {
    await saveProvider(created);
    await setActiveProviderModel(
      created.id,
      created.defaultModel || created.models[0]?.id || ''
    );
    setView('list');
  };

  if (view === 'wizard') {
    return (
      <div key="providers-wizard" className={viewAnim}>
        <Suspense
          fallback={<div className="py-10 text-center text-xs text-muted">加载添加向导…</div>}
        >
          <LazyProviderWizard
            onCancel={() => setView('list')}
            onComplete={handleWizardComplete}
          />
        </Suspense>
      </div>
    );
  }

  if (view === 'edit' && editingProvider) {
    return (
      <ProviderEditorView
        key={editingProvider.id}
        initialProvider={editingProvider}
        providers={providers}
        activeProviderId={activeProviderId}
        activeModelId={activeModelId}
        modelProfileSync={modelProfileSync}
        benchmarkByUrl={benchmarkByUrl}
        benchmarkingUrls={benchmarkingUrls}
        viewAnim={viewAnim}
        onBack={() => setView('list')}
        onDeleteProvider={deleteProvider}
        onBenchmarkEndpoint={handleBenchmarkEndpoint}
        saveProvider={saveProvider}
        setActiveProviderModel={setActiveProviderModel}
        fetchProviderModels={fetchProviderModels}
        testProviderConnection={testProviderConnection}
      />
    );
  }

  return (
    <ProviderListView
      providers={providers}
      activeProviderId={activeProviderId}
      benchmarkByUrl={benchmarkByUrl}
      benchmarkingUrls={benchmarkingUrls}
      viewAnim={viewAnim}
      onEnableProvider={setActiveProviderModel}
      onBenchmarkEndpoint={handleBenchmarkEndpoint}
      onEditProvider={(p) => {
        setEditingProvider(p);
        setView('edit');
      }}
      onStartWizard={() => setView('wizard')}
      saveProvider={saveProvider}
    />
  );
};
