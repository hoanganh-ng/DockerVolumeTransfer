import { Check } from "lucide-react";

interface StepIndicatorProps {
  currentStep: number;
}

const STEPS = [
  { number: 1, label: "Source" },
  { number: 2, label: "Volumes" },
  { number: 3, label: "Destination" },
  { number: 4, label: "Transfer" },
];

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  // Step 5 (summary) reuses step 4 position
  const activePosition = Math.min(Math.max(currentStep, 1), 4);

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        {STEPS.map((step, index) => {
          const isCompleted = currentStep > step.number || (currentStep >= 5 && step.number === 4);
          const isCurrent = !isCompleted && activePosition === step.number;

          return (
            <div key={step.number} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all select-none ${
                    isCompleted
                      ? "bg-blue-600 text-white"
                      : isCurrent
                      ? "bg-blue-600 text-white ring-4 ring-blue-500/30"
                      : "bg-slate-800 text-slate-400 border border-slate-700"
                  }`}
                  data-testid={`step-indicator-${step.number}`}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5 text-white" aria-hidden="true" />
                  ) : (
                    <span>{step.number}</span>
                  )}
                </div>
                <span
                  className={`mt-2 text-xs font-medium text-center ${
                    isCompleted || isCurrent ? "text-slate-200" : "text-slate-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {index < STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 mx-2 sm:mx-4 -mt-6 transition-colors ${
                    currentStep > step.number ? "bg-blue-600" : "bg-slate-800"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default StepIndicator;
