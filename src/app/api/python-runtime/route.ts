import { NextResponse } from 'next/server';
import { resolvePythonBinary, getPythonVersion, isBundledPythonAvailable } from '@/lib/python-runtime';
import { isVenvReady, getVenvDir, listPackages } from '@/lib/python-venv';

export async function GET() {
  try {
    const pythonPath = resolvePythonBinary();
    const version = pythonPath ? getPythonVersion(pythonPath) : null;
    const venvReady = isVenvReady();
    const packages = venvReady ? await listPackages() : [];

    return NextResponse.json({
      available: pythonPath !== null,
      bundled: isBundledPythonAvailable(),
      pythonPath,
      version,
      venv: {
        ready: venvReady,
        dir: getVenvDir(),
        packages,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check Python runtime' },
      { status: 500 },
    );
  }
}
