import { History } from "lucide-react";
import { useAppStore } from "./store";
import { StepIndicator } from "./components/wizard/StepIndicator";
import { SelectSource } from "./components/wizard/SelectSource";
import { SelectVolumes } from "./components/wizard/SelectVolumes";
import { SelectDestination } from "./components/wizard/SelectDestination";

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
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400">
            <div className="max-w-md text-center p-8 bg-slate-800/50 rounded-xl border border-slate-800">
              <History className="w-12 h-12 text-slate-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-200 mb-2">
                Transfer History
              </h2>
              <p className="text-sm text-slate-400 mb-6">
                History view component placeholder (implemented in Task 9).
              </p>
              <button
                onClick={() => setShowHistory(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition-colors border border-slate-700"
              >
                Back to Wizard
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <StepIndicator currentStep={step} />

            <div className="flex-1 max-w-5xl w-full mx-auto px-6 pb-8 flex flex-col">
              {step === 1 && <SelectSource />}
              {step === 2 && <SelectVolumes />}
              {step === 3 && <SelectDestination />}
              {step === 4 && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 border border-dashed border-slate-800 rounded-xl p-12">
                  <div className="text-lg font-medium text-slate-200 mb-1">
                    Step 4: Transfer Progress
                  </div>
                  <p className="text-sm text-slate-500">
                    TransferProgress placeholder (Task 8)
                  </p>
                </div>
              )}
              {step === 5 && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 border border-dashed border-slate-800 rounded-xl p-12">
                  <div className="text-lg font-medium text-slate-200 mb-1">
                    Step 5: Transfer Complete
                  </div>
                  <p className="text-sm text-slate-500">
                    TransferComplete placeholder (Task 8)
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
