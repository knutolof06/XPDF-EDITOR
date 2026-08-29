import React, { useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { AIService } from '@/core/ai/ai-service';
import { AIChatMessage } from '@/types/advanced';
import {
  Sparkles,
  Send,
  HelpCircle,
  Bot,
  User,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const AIAssistantPanel: React.FC = () => {
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const { addToast } = useUIStore();

  const [messages, setMessages] = useState<AIChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Merhaba! Ben XPDF Yapay Zeka Asistanıyım. Bu dökümanı özetleyebilir, içindeki soruları bulabilir veya dökümanla ilgili istediğiniz soruları yanıtlayabilirim.',
      timestamp: Date.now(),
    },
  ]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  if (!currentDocument || !pdfDocProxy) return null;

  const handleQuickSummarize = async () => {
    try {
      setIsGenerating(true);
      const userMsg: AIChatMessage = {
        id: 'u_' + Date.now(),
        role: 'user',
        content: 'Bu PDF dökümanını özetle.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      const summary = await AIService.generateSummary(pdfDocProxy, currentDocument.name);
      const aiMsg: AIChatMessage = {
        id: 'ai_' + Date.now(),
        role: 'assistant',
        content: summary,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
      addToast('Özetleme sırasında hata oluştu.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleQuickQuestions = async () => {
    try {
      setIsGenerating(true);
      const userMsg: AIChatMessage = {
        id: 'u_' + Date.now(),
        role: 'user',
        content: 'Dökümandaki önemli soruları ve konuları çıkar.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      const questions = await AIService.extractKeyQuestions(pdfDocProxy);
      let content = '❓ **Dökümanda Tespit Edilen Başlıca Sorular:**\n\n';
      if (questions.length > 0) {
        questions.forEach((q, idx) => {
          content += `${idx + 1}. ${q}\n\n`;
        });
      } else {
        content += 'Döküman içerisinde belirgin soru işaretiyle biten başlık bulunamadı.';
      }

      const aiMsg: AIChatMessage = {
        id: 'ai_' + Date.now(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputQuestion.trim() || isGenerating) return;

    const q = inputQuestion.trim();
    setInputQuestion('');

    const userMsg: AIChatMessage = {
      id: 'u_' + Date.now(),
      role: 'user',
      content: q,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsGenerating(true);

    try {
      const answer = await AIService.answerQuestion(pdfDocProxy, q);
      const aiMsg: AIChatMessage = {
        id: 'ai_' + Date.now(),
        role: 'assistant',
        content: answer,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
      addToast('Yanıt üretilirken hata oluştu.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none bg-slate-900/50">
      {/* Quick Action Badges */}
      <div className="p-3 border-b border-slate-800 space-y-2 shrink-0">
        <span className="text-[11px] font-semibold text-slate-400 block">Hızlı AI Eylemleri</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={handleQuickSummarize}
            disabled={isGenerating}
            className="px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 text-[11px] font-semibold border border-sky-500/30 flex items-center gap-1 transition-colors"
          >
            <Sparkles className="w-3 h-3 text-sky-400" />
            Dökümanı Özetle
          </button>
          <button
            onClick={handleQuickQuestions}
            disabled={isGenerating}
            className="px-2.5 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-[11px] font-semibold border border-purple-500/30 flex items-center gap-1 transition-colors"
          >
            <HelpCircle className="w-3 h-3 text-purple-400" />
            Soruları Bul
          </button>
        </div>
      </div>

      {/* Chat Messages Log */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'flex gap-2 text-xs leading-relaxed',
              m.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {m.role === 'assistant' && (
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-sky-500 flex items-center justify-center text-white shrink-0 shadow-sm">
                <Bot className="w-3.5 h-3.5" />
              </div>
            )}

            <div
              className={cn(
                'p-3 rounded-2xl max-w-[85%] whitespace-pre-wrap',
                m.role === 'user'
                  ? 'bg-sky-600 text-white rounded-tr-sm'
                  : 'bg-slate-800/80 border border-slate-700/70 text-slate-200 rounded-tl-sm'
              )}
            >
              {m.content}
            </div>

            {m.role === 'user' && (
              <div className="w-6 h-6 rounded-lg bg-slate-700 flex items-center justify-center text-slate-300 shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        ))}

        {isGenerating && (
          <div className="flex gap-2 text-xs items-center text-slate-400">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-sky-500 flex items-center justify-center text-white shrink-0 animate-pulse">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <span>Yapay Zeka dökümanı analiz ediyor...</span>
          </div>
        )}
      </div>

      {/* Question Form */}
      <form onSubmit={handleSendQuestion} className="p-3 border-t border-slate-800 flex items-center gap-1.5 shrink-0 bg-slate-900">
        <input
          type="text"
          value={inputQuestion}
          onChange={(e) => setInputQuestion(e.target.value)}
          placeholder="PDF hakkında bir soru sorun..."
          className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 placeholder:text-slate-500 text-xs focus:outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={!inputQuestion.trim() || isGenerating}
          className="p-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white transition-colors"
          title="Gönder"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
