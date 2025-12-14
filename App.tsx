import React, { useState, useEffect } from 'react';
import { Mic, Square, AlertCircle, Radio, Server, Cpu, Settings, RefreshCw, ChevronDown, Wifi, WifiOff, ChevronUp } from 'lucide-react';
import { useLocalTranslator } from './hooks/useGeminiTranslator';
import { ConnectionState } from './types';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [modelName, setModelName] = useState('llama3');
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [prevSelectedModel, setPrevSelectedModel] = useState<string>('llama3');
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const dropdown = document.querySelector('.model-dropdown-container');
      if (dropdown && !dropdown.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const {
    connectionState,
    error,
    statusMessage,
    startTranslation,
    stopTranslation,
    sourceStream,
    availableModels,
    setAvailableModels,
    refreshModels,
    isRefreshingModels,
    ollamaConnectionStatus,
    downloadProgress
  } = useLocalTranslator({ ollamaUrl, modelName });

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;

  // 临时测试函数 - 可以在浏览器控制台运行
  (window as any).testOllamaAPI = async () => {
    try {
      console.log('Testing Ollama API directly...');
      const response = await fetch('http://localhost:11434/api/tags');
      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Full API Response:', data);
      console.log('Models array:', data.models);
      console.log('Models type:', typeof data.models);
      console.log('Is array:', Array.isArray(data.models));

      if (data.models && Array.isArray(data.models)) {
        const names = data.models.map((m: any) => m.name);
        console.log('Extracted names:', names);
        console.log('Names count:', names.length);

        // 测试设置到状态
        setAvailableModels(names);
        console.log('Models set to state');
      } else {
        console.error('No valid models array found');
      }
    } catch (err) {
      console.error('API Test failed:', err);
    }
  };

  // Auto-refresh models on mount
  useEffect(() => {
    console.log('App: Component mounting, refreshing models...');
    refreshModels().then(() => setLastRefreshTime(new Date()));
  }, [refreshModels]);

  // Auto-refresh models when Ollama URL changes
  useEffect(() => {
    console.log('App: Ollama URL changed, refreshing models...');
    refreshModels().then(() => setLastRefreshTime(new Date()));
  }, [ollamaUrl, refreshModels]);

  // Sync modelName with availableModels
  useEffect(() => {
    console.log('App: availableModels updated:', availableModels);
    console.log('App: availableModels length:', availableModels.length);

    // 如果当前选择的模型不在新的模型列表中，尝试选择之前使用的模型，否则选择第一个
    if (availableModels.length > 0) {
      if (!availableModels.includes(modelName)) {
        // 尝试使用之前选择的模型
        if (availableModels.includes(prevSelectedModel)) {
          console.log('Using previously selected model:', prevSelectedModel);
          setModelName(prevSelectedModel);
        } else {
          console.log('Current model not in list, updating to first available model');
          setModelName(availableModels[0]);
        }
      }
    } else if (availableModels.length === 0) {
      console.log('No models available, resetting to default');
      setModelName('llama3');
    }
  }, [availableModels, modelName, prevSelectedModel]);

  
  // Helper function to handle model selection
  const handleModelSelect = (model: string) => {
    setModelName(model);
    setPrevSelectedModel(model);
    setShowDropdown(false);
  };

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

             <div className="flex items-center justify-between mb-2 p-2 bg-slate-800/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Ollama Status:</span>
                  {ollamaConnectionStatus === 'connected' ? (
                    <>
                      <Wifi className="w-3 h-3 text-green-400" />
                      <span className="text-green-400 text-xs">Connected</span>
                    </>
                  ) : ollamaConnectionStatus === 'disconnected' ? (
                    <>
                      <WifiOff className="w-3 h-3 text-red-400" />
                      <span className="text-red-400 text-xs">Disconnected</span>
                    </>
                  ) : (
                    <>
                      <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
                      <span className="text-yellow-400 text-xs">Checking...</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => {
                    refreshModels();
                    setLastRefreshTime(new Date());
                  }}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition-colors"
                  title="Test Connection"
                >
                  Test Connection
                </button>
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
                   <span className="flex items-center gap-2">
                     Model Name
                     {ollamaConnectionStatus === 'connected' && (
                       <span className="text-green-400 text-xs" title="Connected to Ollama">
                         <span className="inline-block w-2 h-2 bg-green-400 rounded-full"></span> Connected
                       </span>
                     )}
                     {ollamaConnectionStatus === 'disconnected' && (
                       <span className="text-red-400 text-xs" title="Cannot connect to Ollama">
                         <span className="inline-block w-2 h-2 bg-red-400 rounded-full"></span> Disconnected
                       </span>
                     )}
                     {availableModels.length > 0 && (
                       <span className={availableModels.includes(modelName) ? "text-green-400 text-xs" : "text-yellow-400 text-xs"}
                             title={availableModels.includes(modelName) ? "Model is available" : "Model not in available list"}>
                         {availableModels.includes(modelName) ? "✓" : "⚠"} {modelName}
                       </span>
                     )}
                     {lastRefreshTime && (
                       <span className="text-slate-600" title={`Last refreshed: ${lastRefreshTime.toLocaleTimeString()}`}>
                         (refreshed {lastRefreshTime.toLocaleTimeString()})
                       </span>
                     )}
                   </span>
                   <button
                     onClick={() => {
                       refreshModels();
                       setLastRefreshTime(new Date());
                       setShowDropdown(true);
                     }}
                     className="text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-all disabled:opacity-50"
                     title="Refresh Models"
                     disabled={isRefreshingModels}
                   >
                     <RefreshCw className={`w-3 h-3 ${isRefreshingModels || isConnecting ? 'animate-spin' : ''}`} />
                     {isRefreshingModels ? 'Refreshing...' : 'Refresh'}
                   </button>
                </label>
                <div className="relative model-dropdown-container">
                  <div className="flex items-center bg-slate-900 rounded-lg px-3 border border-slate-700">
                    <Cpu className="w-4 h-4 text-slate-500 mr-2" />
                    <input
                        type="text"
                        value={modelName}
                        onChange={(e) => {
                          const newModelName = e.target.value;
                          setModelName(newModelName);
                          setShowDropdown(true);
                          if (newModelName && availableModels.includes(newModelName)) {
                            setPrevSelectedModel(newModelName);
                          }
                        }}
                        onFocus={() => setShowDropdown(true)}
                        className="bg-transparent border-none text-slate-200 text-sm py-2 w-full focus:outline-none"
                        placeholder={availableModels.length > 0 ? "Type or select a model..." : "No models available"}
                        disabled={availableModels.length === 0}
                    />
                    <button
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="text-slate-500 hover:text-slate-400 p-1"
                      title={showDropdown ? "Hide dropdown" : "Show dropdown"}
                    >
                      {showDropdown ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Custom Dropdown */}
                  {showDropdown && availableModels.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {availableModels.map((model) => (
                        <div
                          key={model}
                          className={`px-3 py-2 text-sm cursor-pointer hover:bg-slate-700 ${
                            model === modelName ? 'bg-slate-700 text-purple-400' : 'text-slate-300'
                          }`}
                          onClick={() => handleModelSelect(model)}
                          title={model}
                        >
                          {model}
                        </div>
                      ))}
                    </div>
                  )}

                  {availableModels.length === 0 && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-slate-500">
                      No models found
                    </div>
                  )}
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
            <div className="space-y-2">
              <div className="text-xs text-center text-blue-400 animate-pulse">
                  {statusMessage}
              </div>

              {/* Download Progress Bar */}
              {isConnecting && downloadProgress > 0 && downloadProgress < 100 && (
                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">Downloading Model</span>
                    <span className="text-xs text-slate-300 font-medium">{downloadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-purple-400 h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-1 text-center">
                    First-time download only (~40MB)
                  </div>
                </div>
              )}
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

          {/* Ollama Help */}
          <div className="text-xs text-slate-600 bg-slate-900/50 p-3 rounded-lg">
            <div className="font-medium text-slate-300 mb-1">Troubleshooting Ollama Connection:</div>
            <ul className="space-y-1 list-disc list-inside">
              <li>Make sure Ollama is running: <code className="bg-slate-800 px-1 rounded">ollama serve</code></li>
              <li>Check Ollama is listening on port 11434 (default)</li>
              <li>Set environment variable: <code className="bg-slate-800 px-1 rounded">export OLLAMA_ORIGINS="*"</code></li>
              <li>Try accessing <code className="bg-slate-800 px-1 rounded">{ollamaUrl}/api/tags</code> in browser</li>
              <li>Firewall may be blocking the connection</li>
            </ul>
          </div>

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