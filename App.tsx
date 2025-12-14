import React, { useState, useEffect } from 'react';
import { Mic, Square, AlertCircle, Radio, Server, Cpu, Settings, RefreshCw, ChevronDown } from 'lucide-react';
import { useLocalTranslator } from './hooks/useGeminiTranslator';
import { ConnectionState } from './types';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [modelName, setModelName] = useState('llama3'); 

  const { 
    connectionState, 
    error, 
    statusMessage,
    startTranslation, 
    stopTranslation, 
    sourceStream,
    availableModels,
    refreshModels
  } = useLocalTranslator({ ollamaUrl, modelName });

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;

  // Auto-refresh models on mount
  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-900 p-6 border-b border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <div className="bg-purple-600 p-2 rounded-lg">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-white">Local Interpreter</h1>
            </div>
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${
              isConnected ? 'bg-green-500/10 text-green-400' : 'bg-slate-800 text-slate-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
              <span>{isConnected ? 'ACTIVE' : 'READY'}</span>
            </div>
          </div>
          <p className="text-slate-400 text-sm">
            Chrome Tab Audio &rarr; Local Whisper &rarr; Ollama &rarr; TTS
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
            
          {/* Config Section */}
          <div className="space-y-3 bg-slate-800/50 p-4 rounded-xl border border-slate-800">
             <div className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Settings className="w-4 h-4" /> Local Configuration
             </div>
             
             <div>
                <label className="text-xs text-slate-500 mb-1 block">Ollama URL</label>
                <div className="flex items-center bg-slate-900 rounded-lg px-3 border border-slate-700">
                    <Server className="w-4 h-4 text-slate-500 mr-2" />
                    <input 
                        type="text" 
                        value={ollamaUrl}
                        onChange={(e) => setOllamaUrl(e.target.value)}
                        onBlur={() => refreshModels()}
                        className="bg-transparent border-none text-slate-200 text-sm py-2 w-full focus:outline-none"
                        placeholder="http://localhost:11434"
                    />
                </div>
             </div>

             <div>
                <label className="text-xs text-slate-500 mb-1 flex justify-between">
                   <span>Model Name</span>
                   <button 
                     onClick={() => refreshModels()} 
                     className="text-purple-400 hover:text-purple-300 flex items-center gap-1"
                     title="Refresh Models"
                   >
                     <RefreshCw className="w-3 h-3" /> Refresh
                   </button>
                </label>
                <div className="flex items-center bg-slate-900 rounded-lg px-3 border border-slate-700 relative">
                    <Cpu className="w-4 h-4 text-slate-500 mr-2" />
                    <input 
                        type="text" 
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        list="models-list"
                        className="bg-transparent border-none text-slate-200 text-sm py-2 w-full focus:outline-none z-10"
                        placeholder="Select or type model..."
                    />
                    <ChevronDown className="w-4 h-4 text-slate-600 absolute right-3 pointer-events-none" />
                    <datalist id="models-list">
                      {availableModels.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                </div>
             </div>
          </div>

          {/* Visualizer */}
          <div className="space-y-2">
             <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-2">
                    <Radio className="w-4 h-4" /> Input Audio
                </span>
             </div>
             <Visualizer 
                stream={sourceStream} 
                isActive={isConnected} 
                color="#a855f7" // Purple
             />
          </div>

          {/* Messages */}
          {statusMessage && (
              <div className="text-xs text-center text-blue-400 animate-pulse">
                  {statusMessage}
              </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                 <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                 <div className="text-sm text-red-200">{error}</div>
              </div>
              {error.includes("OLLAMA_ORIGINS") && (
                  <div className="text-xs text-slate-400 bg-slate-900/50 p-2 rounded select-all font-mono">
                      export OLLAMA_ORIGINS="*" &amp;&amp; ollama serve
                  </div>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="pt-2">
            {!isConnected && !isConnecting ? (
              <button
                onClick={startTranslation}
                className="w-full group relative flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg shadow-purple-900/20"
              >
                <Mic className="w-5 h-5" />
                <span>Start Local Session</span>
              </button>
            ) : (
              <button
                onClick={stopTranslation}
                className="w-full flex items-center justify-center gap-3 bg-red-600 hover:bg-red-500 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg shadow-red-900/20"
              >
                {isConnecting ? (
                    <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Loading Models...</span>
                    </>
                ) : (
                    <>
                        <Square className="w-5 h-5 fill-current" />
                        <span>Stop Session</span>
                    </>
                )}
              </button>
            )}
          </div>
          
          <div className="text-center">
             <p className="text-[10px] text-slate-600">
                Requires: <code>ollama run {modelName || 'llama3'}</code>
             </p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default App;