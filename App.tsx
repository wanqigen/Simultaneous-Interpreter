import React, { useState, useEffect } from 'react';
import { Mic, Square, AlertCircle, Radio, Server, Settings, Activity, Wifi, WifiOff, MessageSquare } from 'lucide-react';
import { useLocalTranslator } from './hooks/useGeminiTranslator';
import { ConnectionState } from './types';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  // Updated default URL per user request
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:60808/chat');
  // Use English instruction for the SpeechT5 model
  const [instruction, setInstruction] = useState('You are a translator. Translate the following English speech into Chinese speech directly. Do not answer, just translate.');
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);

  const {
    connectionState,
    error,
    statusMessage,
    startTranslation,
    stopTranslation,
    sourceStream,
    serverStatus,
    checkConnection
  } = useLocalTranslator({ serverUrl, instruction });

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;

  // Check connection on mount and url change
  useEffect(() => {
    checkConnection().then(() => setLastCheckTime(new Date()));
  }, [checkConnection]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-900 p-6 border-b border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <div className="bg-blue-600 p-2 rounded-lg">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-white">Mini-Omni Interpreter</h1>
            </div>
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${
              isConnected ? 'bg-green-500/10 text-green-400' : 'bg-slate-800 text-slate-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
              <span>{isConnected ? 'ACTIVE' : 'READY'}</span>
            </div>
          </div>
          <p className="text-slate-400 text-sm">
            Real-time Speech-to-Speech Translation via Mini-Omni
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
            
          {/* Config Section */}
          <div className="space-y-4 bg-slate-800/50 p-4 rounded-xl border border-slate-800">
             <div className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Settings className="w-4 h-4" /> Server Configuration
             </div>

             <div className="flex items-center justify-between mb-2 p-2 bg-slate-800/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">API Status:</span>
                  {serverStatus === 'connected' ? (
                    <>
                      <Wifi className="w-3 h-3 text-green-400" />
                      <span className="text-green-400 text-xs">Connected</span>
                    </>
                  ) : serverStatus === 'disconnected' ? (
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
                    checkConnection();
                    setLastCheckTime(new Date());
                  }}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition-colors"
                >
                  Test
                </button>
             </div>
             
             <div>
                <label className="text-xs text-slate-500 mb-1 block">API Endpoint</label>
                <div className="flex items-center bg-slate-900 rounded-lg px-3 border border-slate-700">
                    <Server className="w-4 h-4 text-slate-500 mr-2" />
                    <input 
                        type="text" 
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        onBlur={() => checkConnection()}
                        className="bg-transparent border-none text-slate-200 text-sm py-2 w-full focus:outline-none"
                        placeholder="http://127.0.0.1:60808/chat"
                    />
                </div>
             </div>

             <div>
                <label className="text-xs text-slate-500 mb-1 block">Instruction (TTS Prompt)</label>
                <div className="flex items-start bg-slate-900 rounded-lg px-3 border border-slate-700">
                    <MessageSquare className="w-4 h-4 text-slate-500 mr-2 mt-2.5" />
                    <textarea 
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        className="bg-transparent border-none text-slate-200 text-sm py-2 w-full focus:outline-none resize-none h-24"
                        placeholder="Enter English instruction (e.g. Translate to Chinese)"
                    />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                   Note: Please use English for the TTS instruction prompt.
                </p>
             </div>
          </div>

          {/* Visualizer */}
          <div className="space-y-2">
             <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-2">
                    <Radio className="w-4 h-4" /> Input Audio (24kHz)
                </span>
             </div>
             <Visualizer 
                stream={sourceStream} 
                isActive={isConnected} 
                color="#3b82f6" // Blue
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
            </div>
          )}

          {/* Controls */}
          <div className="pt-2">
            {!isConnected && !isConnecting ? (
              <button
                onClick={startTranslation}
                className="w-full group relative flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg shadow-blue-900/20"
              >
                <Mic className="w-5 h-5" />
                <span>Start Session</span>
              </button>
            ) : (
              <button
                onClick={stopTranslation}
                className="w-full flex items-center justify-center gap-3 bg-red-600 hover:bg-red-500 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg shadow-red-900/20"
              >
                {isConnecting ? (
                    <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Connecting...</span>
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
                Ensure local Mini-Omni server is running on port 60808.
             </p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default App;