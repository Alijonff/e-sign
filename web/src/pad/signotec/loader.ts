import { PadError } from '@e-sign/shared';
import type { SignotecLibrary } from './vendor.d';

let loading: Promise<SignotecLibrary> | undefined;

function libraryFromWindow(): SignotecLibrary | undefined {
  const commons = window.STPadServerLibCommons;
  const standard = window.STPadServerLibDefault;
  if (commons && standard) return { commons, standard };
}

export function loadSignotec(): Promise<SignotecLibrary> {
  const library = libraryFromWindow();
  if (library) return Promise.resolve(library);
  if (loading) return loading;

  const script = document.createElement('script');
  script.src = import.meta.env.VITE_SIGNOTEC_LIB_URL || '/vendor/STPadServerLib.js';
  script.async = true;

  loading = new Promise<SignotecLibrary>((resolve, reject) => {
    function fail() {
      reject(new PadError(
        'service_unavailable',
        'Библиотека signotec не найдена: положите файл в web/public/vendor/',
      ));
    }

    script.onload = () => {
      const loaded = libraryFromWindow();
      if (loaded) resolve(loaded);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => {
    script.remove();
    loading = undefined;
    throw error;
  });

  return loading;
}
