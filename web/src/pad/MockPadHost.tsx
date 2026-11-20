import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getMockCapture, subscribeMockCapture } from './mock';
import { MockCanvas } from './MockCanvas';

export function MockPadHost() {
  const capture = useSyncExternalStore(subscribeMockCapture, getMockCapture);

  if (!capture) return null;
  return createPortal(
    <MockCanvas
      key={capture.id}
      prompt={capture.prompt}
      onConfirm={capture.confirm}
      onCancel={capture.cancel}
      onError={capture.fail}
    />,
    document.body,
  );
}
