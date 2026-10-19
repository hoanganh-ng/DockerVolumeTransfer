import { History } from "lucide-react";
import { useAppStore } from "./store";
import { StepIndicator } from "./components/wizard/StepIndicator";
import { SelectSource } from "./components/wizard/SelectSource";
import { SelectVolumes } from "./components/wizard/SelectVolumes";
import { SelectDestination } from "./components/wizard/SelectDestination";
import { TransferProgress } from "./components/wizard/TransferProgress";
import { TransferComplete } from "./components/wizard/TransferComplete";
import { TransferHistory } from "./components/history/TransferHistory";

export default function App() {
  const { step, showHistory, setShowHistory } = useAppStore();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col select-none">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-base">
              D
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-100 tracking-tight leading-none">
                Docker Volume Transfer
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Zero-downtime server-to-server volume migration
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                showHistory
                  ? "bg-blue-600/20 text-blue-400 border-blue-500/40"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700"
              }`}
              title="Transfer History"
              aria-label="Transfer History"
            >
              <History className="w-4 h-4" />
              <span>History</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 flex flex-col">
        {showHistory ? (
          <TransferHistory />
        ) : (
          <div className="flex-1 flex flex-col">
            <StepIndicator currentStep={step} />

            <div className="flex-1 max-w-5xl w-full mx-auto px-6 pb-8 flex flex-col">
              {step === 1 && <SelectSource />}
              {step === 2 && <SelectVolumes />}
              {step === 3 && <SelectDestination />}
              {step === 4 && <TransferProgress />}
              {step === 5 && <TransferComplete />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
