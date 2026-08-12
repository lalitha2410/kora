import { useState } from 'react';
import { useCartRecoveryAgent } from './hooks/useCartRecoveryAgent';
import { getScenario } from './data/scenarios';
import { TopBar } from './components/TopBar';
import { ChatPanel } from './components/ChatPanel';
import { CampaignDashboard } from './components/CampaignDashboard';
import { ApiKeyNotice } from './components/ApiKeyNotice';
import { SplitView } from './components/SplitView';
import { IntroOverlay } from './components/IntroOverlay';

function App() {
  const {
    brand,
    apiKeyMissing,
    carts,
    stats,
    statsByType,
    activeCartId,
    setActiveCartId,
    activeThread,
    sendMessage,
    runScenario,
    reset,
    markPaid,
  } = useCartRecoveryAgent();
  // Deliberately not part of the hook's reset() — Reset should never bring
  // this back mid-demo, only a fresh page load should.
  const [showIntro, setShowIntro] = useState(true);

  const activeCart = carts.find((c) => c.cartId === activeCartId) ?? carts[0];

  function handleRunScenario(scenarioId: string) {
    const scenario = getScenario(scenarioId);
    if (scenario) void runScenario(scenario);
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#f6f7f8]">
      {showIntro && <IntroOverlay accent={brand.colors.accentDark} onDismiss={() => setShowIntro(false)} />}

      <TopBar brand={brand} onReset={reset} />

      <SplitView
        accent={brand.colors.accentDark}
        left={
          apiKeyMissing ? (
            <ApiKeyNotice />
          ) : (
            <ChatPanel
              brand={brand}
              carts={carts}
              activeCart={activeCart}
              messages={activeThread.messages}
              isTyping={activeThread.isTyping}
              streamingText={activeThread.streamingText}
              disabled={apiKeyMissing}
              onSelectCart={setActiveCartId}
              onSend={(text) => sendMessage(activeCartId, text)}
              onRunScenario={handleRunScenario}
            />
          )
        }
        right={
          <CampaignDashboard
            brand={brand}
            carts={carts}
            stats={stats}
            statsByType={statsByType}
            toolActivity={activeThread.toolActivity}
            activeCartId={activeCartId}
            onSelectCart={setActiveCartId}
            onMarkPaid={markPaid}
          />
        }
      />
    </div>
  );
}

export default App;
