
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { TranscriptItem, Language, LANGUAGES, AppMode, Theme, AccentColor } from './types';
import { encode, decode, decodeAudioData, createBlob } from './utils/audio';

type OperationalMode = 'lecture' | 'interview';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [opMode, setOpMode] = useState<OperationalMode>('interview');
  const [targetLang, setTargetLang] = useState<Language>(LANGUAGES[1]); // Default English
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [volume, setVolume] = useState(0.7);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  
  // Design states
  const [theme, setTheme] = useState<Theme>('midnight');
  const [accent, setAccent] = useState<AccentColor>('indigo');
  const [showDesignMenu, setShowDesignMenu] = useState(false);

  const transcriptsEndRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<{
    input: AudioContext;
    output: AudioContext;
    inputNode: GainNode;
    outputNode: GainNode;
  } | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const currentTranscriptionRef = useRef({ input: '', output: '' });

  const themeStyles = {
    midnight: {
      bg: 'bg-slate-950',
      header: 'bg-slate-900 border-slate-800',
      cardUser: 'bg-slate-800/50 border-slate-700/50',
      textMain: 'text-slate-100',
      textMuted: 'text-slate-400',
      gradient: 'bg-[radial-gradient(circle_at_50%_0%,rgba(30,41,59,1)_0%,rgba(15,23,42,1)_100%)]'
    },
    dark: {
      bg: 'bg-zinc-950',
      header: 'bg-zinc-900 border-zinc-800',
      cardUser: 'bg-zinc-800/50 border-zinc-700/50',
      textMain: 'text-zinc-100',
      textMuted: 'text-zinc-400',
      gradient: 'bg-zinc-950'
    },
    light: {
      bg: 'bg-slate-50',
      header: 'bg-white border-slate-200',
      cardUser: 'bg-white border-slate-200 shadow-sm',
      textMain: 'text-slate-900',
      textMuted: 'text-slate-500',
      gradient: 'bg-slate-50'
    }
  };

  const accentStyles = {
    indigo: { primary: 'bg-indigo-600', text: 'text-indigo-400', shadow: 'shadow-indigo-500/20', hover: 'hover:bg-indigo-500' },
    emerald: { primary: 'bg-emerald-600', text: 'text-emerald-400', shadow: 'shadow-emerald-500/20', hover: 'hover:bg-emerald-500' },
    rose: { primary: 'bg-rose-600', text: 'text-rose-400', shadow: 'shadow-rose-500/20', hover: 'hover:bg-rose-500' }
  };

  const currentTheme = themeStyles[theme];
  const currentAccent = accentStyles[accent];

  useEffect(() => {
    const checkKey = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio) {
        const has = await aistudio.hasSelectedApiKey();
        setHasApiKey(has);
      }
    };
    checkKey();
    const interval = setInterval(checkKey, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    transcriptsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  useEffect(() => {
    if (opMode === 'lecture') setAccent('emerald');
    else setAccent('indigo');
  }, [opMode]);

  const initAudio = async () => {
    if (!audioContextRef.current) {
      const input = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const output = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inputNode = input.createGain();
      const outputNode = output.createGain();
      outputNode.gain.value = volume;
      outputNode.connect(output.destination);
      audioContextRef.current = { input, output, inputNode, outputNode };
    }
    return audioContextRef.current;
  };

  const handleConnectKey = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio) {
      await aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const handleStart = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio) {
      const selected = await aistudio.hasSelectedApiKey();
      if (!selected) await handleConnectKey();
    }

    try {
      setMode(AppMode.LISTENING);
      const { input, output, outputNode } = await initAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const lectureInstruction = `You are a LECTURE TRANSLATOR. 
          User's native language is Russian. 
          The lecture is being given in: ${targetLang.name} (${targetLang.code}).
          
          STRICT RULES:
          1. Detect the speaker's language.
          2. IF the speaker is using ${targetLang.name} (or any language other than Russian): 
             - Translate it into Russian.
             - PROVIDE both Russian audio and Russian text output.
          3. IF the speaker is using RUSSIAN (this is the user or nearby talkers):
             - DO NOT output anything.
             - No text, no audio, no transcription. Just stay silent.
          4. Focus solely on delivering the translated lecture content in Russian.`;

      const interviewInstruction = `You are an INTERVIEW TRANSLATOR. 
          Participant 1 speaks Russian. 
          Participant 2 speaks: ${targetLang.name} (${targetLang.code}).
          
          STRICT RULES:
          1. IF Russian is spoken: Translate it to ${targetLang.name} and provide ${targetLang.name} audio + text.
          2. IF ${targetLang.name} is spoken: Translate it to Russian and provide Russian audio + text.
          3. Always translate between Russian and ${targetLang.name}.
          4. Keep the tone professional and the translation accurate.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: opMode === 'lecture' ? lectureInstruction : interviewInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            const source = input.createMediaStreamSource(stream);
            const scriptProcessor = input.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && isAudioEnabled) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, output.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), output, 24000, 1);
              const source = output.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNode);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.inputTranscription) {
              currentTranscriptionRef.current.input += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentTranscriptionRef.current.output += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = currentTranscriptionRef.current.input.trim();
              const modelText = currentTranscriptionRef.current.output.trim();
              
              if (modelText) {
                if (userText && opMode === 'interview') {
                   setTranscripts(prev => [...prev, { id: Math.random().toString(36), role: 'user', text: userText, timestamp: Date.now() }]);
                }
                setTranscripts(prev => [...prev, { id: Math.random().toString(36), role: 'model', text: modelText, timestamp: Date.now() }]);
              }
              
              currentTranscriptionRef.current = { input: '', output: '' };
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Gemini Live Error:', e);
            setMode(AppMode.ERROR);
          },
          onclose: () => setMode(AppMode.IDLE)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error('Failed to start session:', err);
      setMode(AppMode.ERROR);
    }
  };

  const handleStop = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setMode(AppMode.IDLE);
  };

  const handleDownload = () => {
    if (transcripts.length === 0) return;
    const content = transcripts.map(t => {
      const time = new Date(t.timestamp).toLocaleTimeString();
      const role = t.role === 'user' ? 'Input' : 'AI Translation';
      return `[${time}] ${role}: ${t.text}`;
    }).join('\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `voxbridge-${opMode}-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={`flex flex-col h-screen ${currentTheme.bg} ${currentTheme.textMain} transition-colors duration-300 overflow-hidden`}>
      <header className={`p-4 ${currentTheme.header} border-b flex items-center justify-between shadow-lg z-30`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 ${currentAccent.primary} rounded-xl flex items-center justify-center ${currentAccent.shadow} shadow-lg transition-all duration-300`}>
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div className="hidden xs:block">
            <h1 className="font-bold text-lg leading-none">VoxBridge</h1>
            <p className={`text-[10px] ${currentTheme.textMuted} mt-1 uppercase tracking-widest font-black`}>AI Real-Time Interpreter</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase flex items-center gap-2 ${opMode === 'lecture' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
            {opMode === 'lecture' ? 'Lecture Mode' : 'Interview Mode'}
          </div>

          <button 
            onClick={() => setShowDesignMenu(!showDesignMenu)}
            className={`p-2 rounded-lg transition-all ${showDesignMenu ? currentAccent.primary + ' text-white' : (theme === 'light' ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-300')}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
          
          {showDesignMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDesignMenu(false)}></div>
              <div className={`absolute right-4 mt-12 w-48 p-3 rounded-2xl shadow-2xl border ${theme === 'light' ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-white'} z-50`}>
                <span className="text-[9px] font-bold uppercase tracking-widest opacity-50 mb-2 block text-center">Base Theme</span>
                <div className="grid grid-cols-3 gap-2">
                  {(['midnight', 'dark', 'light'] as Theme[]).map(t => (
                    <button key={t} onClick={() => setTheme(t)} className={`h-8 rounded-lg text-[9px] font-bold border transition-all ${theme === t ? 'border-indigo-500 bg-indigo-500/10' : 'border-transparent'}`}>{t}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          <button onClick={handleConnectKey} className={`p-2 rounded-lg transition-all ${hasApiKey ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </header>

      <main className={`flex-1 overflow-y-auto p-4 custom-scrollbar transition-all duration-500 ${currentTheme.gradient}`}>
        <div className="max-w-2xl mx-auto space-y-4 pt-4">
          {transcripts.length === 0 && mode === AppMode.IDLE && (
            <div className="flex flex-col items-center justify-center py-24 text-center space-y-6">
              <div className={`w-24 h-24 ${theme === 'light' ? 'bg-white shadow-md' : 'bg-slate-800'} rounded-3xl flex items-center justify-center text-5xl transition-all duration-500 rotate-3 hover:rotate-0`}>
                {opMode === 'lecture' ? '🎓' : '🤝'}
              </div>
              <div>
                <h2 className="text-2xl font-black tracking-tight mb-2">
                  Ready for {opMode === 'lecture' ? 'a Lecture' : 'an Interview'}
                </h2>
                <p className={`${currentTheme.textMuted} max-w-xs text-sm leading-relaxed mx-auto`}>
                  {opMode === 'lecture' 
                    ? "Буду переводить иностранную лекцию на русский. Твой голос будет полностью игнорироваться."
                    : "Двусторонний перевод. И твой голос на иностранный, и иностранный голос на русский."
                  }
                </p>
              </div>
            </div>
          )}

          {transcripts.map((item) => (
            <div key={item.id} className={`flex flex-col ${item.role === 'user' ? 'items-start' : 'items-end'} animate-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[90%] p-4 rounded-3xl shadow-sm ${
                item.role === 'user' 
                  ? `${currentTheme.cardUser} rounded-tl-none` 
                  : `${currentAccent.primary} text-white rounded-tr-none shadow-xl shadow-current/10`
              }`}>
                <div className="text-[9px] opacity-60 mb-1 font-black uppercase tracking-widest flex items-center gap-1.5">
                  <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="w-0.5 h-0.5 bg-current rounded-full"></span>
                  <span>{item.role === 'user' ? 'Speaker' : 'Translation'}</span>
                </div>
                <p className="text-[15px] leading-relaxed font-semibold">
                  {item.text}
                </p>
              </div>
            </div>
          ))}
          
          {mode === AppMode.LISTENING && (
            <div className={`flex items-center gap-3 ${currentAccent.text} py-6 font-bold text-sm`}>
              <div className="flex gap-1">
                <span className={`w-1.5 h-4 ${currentAccent.primary} rounded-full animate-[bounce_1s_infinite_100ms]`}></span>
                <span className={`w-1.5 h-6 ${currentAccent.primary} rounded-full animate-[bounce_1s_infinite_200ms]`}></span>
                <span className={`w-1.5 h-4 ${currentAccent.primary} rounded-full animate-[bounce_1s_infinite_300ms]`}></span>
              </div>
              {opMode === 'lecture' ? `Listening to ${targetLang.name} Lecture...` : 'Translating Conversation...'}
            </div>
          )}
          <div ref={transcriptsEndRef} />
        </div>
      </main>

      <footer className={`p-6 ${currentTheme.header} border-t shadow-[0_-10px_25px_rgba(0,0,0,0.15)] z-20 safe-bottom`}>
        <div className="max-w-md mx-auto space-y-6">
          <div className="w-full">
            <div className="flex justify-between items-center mb-2 px-1">
              <label className={`text-[10px] ${currentTheme.textMuted} uppercase font-black tracking-widest flex items-center gap-2`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" clipRule="evenodd" />
                </svg>
                Output Volume
              </label>
              <span className={`text-[10px] ${currentTheme.textMuted} font-black`}>{Math.round(volume * 100)}%</span>
            </div>
            <input 
              type="range" min="0" max="1" step="0.05" value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                if (audioContextRef.current) audioContextRef.current.outputNode.gain.value = v;
              }}
              className={`w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-800 accent-white transition-all`}
              style={{ accentColor: currentAccent.primary.replace('bg-', '#').replace('indigo-600', '#4f46e5').replace('emerald-600', '#10b981') }}
            />
          </div>

          <div className="grid grid-cols-2 p-1 bg-slate-800/50 rounded-2xl border border-slate-700/50">
            <button 
              onClick={() => setOpMode('lecture')}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl transition-all font-black text-[11px] uppercase tracking-tighter ${opMode === 'lecture' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400'}`}
            >
              🎓 Lecture
            </button>
            <button 
              onClick={() => setOpMode('interview')}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl transition-all font-black text-[11px] uppercase tracking-tighter ${opMode === 'interview' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}
            >
              🤝 Interview
            </button>
          </div>

          <div className="w-full space-y-2">
            <div className={`flex items-center gap-2 p-1.5 rounded-2xl w-full justify-start overflow-x-auto no-scrollbar ${theme === 'light' ? 'bg-slate-100' : 'bg-slate-900/50'}`}>
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setTargetLang(l)}
                  className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex-shrink-0 flex items-center gap-2 ${targetLang.code === l.code ? `${currentAccent.primary} text-white shadow-lg scale-105` : `${currentTheme.textMuted} hover:bg-white/5`}`}
                >
                  <span className="text-lg">{l.flag}</span>
                  <span className="text-[11px] font-black uppercase tracking-tighter">{l.short}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {mode === AppMode.IDLE ? (
              <button
                onClick={handleStart}
                className={`flex-1 h-16 ${currentAccent.primary} ${currentAccent.hover} text-white font-black rounded-3xl shadow-2xl ${currentAccent.shadow} flex items-center justify-center gap-3 transition-all active:scale-95 text-lg uppercase tracking-tight`}
              >
                <div className="w-4 h-4 bg-white rounded-full animate-pulse"></div>
                Start Bridge
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="flex-1 h-16 bg-red-600 hover:bg-red-500 text-white font-black rounded-3xl shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95 text-lg uppercase tracking-tight"
              >
                <div className="w-4 h-4 bg-white rounded-sm"></div>
                Stop
              </button>
            )}

            <button 
              onClick={handleDownload}
              disabled={transcripts.length === 0}
              className={`w-16 h-16 rounded-3xl flex items-center justify-center transition-all disabled:opacity-20 ${theme === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-slate-800 text-slate-200'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            height: 20px;
            width: 20px;
            border-radius: 50%;
            background: white;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            border: 4px solid currentColor;
        }
      `}</style>
    </div>
  );
};

export default App;
