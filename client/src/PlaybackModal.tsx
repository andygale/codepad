import React, { useEffect, useState } from 'react';
import { Modal, Slider } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

interface Snapshot { seq: number; code_snapshot: string; }

interface Props {
  roomId: string;
  language: string;
  visible: boolean;
  onClose: () => void;
}

const PlaybackModal: React.FC<Props> = ({ roomId, language, visible, onClose }) => {
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!visible) return;
    axios.get<Snapshot[]>(`${API_URL}/api/rooms/${roomId}/history`).then(r => {
      setHistory(r.data);
      setIdx(0);
    });
  }, [visible, roomId]);

  const code = history[idx]?.code_snapshot || '';

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width="90vw"
      style={{ top: 20 }}
      destroyOnClose
      closeIcon={<CloseOutlined style={{ color: '#ffffff', fontSize: 18 }} />}
    >
      <Editor
        language={language === 'python3' ? 'python' : language === 'deno' ? 'typescript' : language}
        value={code}
        height="70vh"
        theme="vs-dark"
        options={{ readOnly: true, minimap: { enabled: false } }}
      />
      <div style={{ marginTop: 24 }}>
        <Slider
          min={0}
          max={history.length - 1}
          value={idx}
          onChange={(v: number) => setIdx(v)}
          tooltip={{ formatter: (v?: number) => `Step ${v}` }}
        />
      </div>
    </Modal>
  );
};

export default PlaybackModal; 