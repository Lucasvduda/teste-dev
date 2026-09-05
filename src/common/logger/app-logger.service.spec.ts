import { AppLogger } from './app-logger.service';

describe('AppLogger', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('escreve mensagem simples em stdout como JSON estruturado', () => {
    const logger = new AppLogger();
    logger.log('Nest application successfully started', 'Bootstrap');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(written.level).toBe('info');
    expect(written.context).toBe('Bootstrap');
    expect(written.message).toBe('Nest application successfully started');
    expect(typeof written.timestamp).toBe('string');
  });

  it('desembrulha mensagem JSON em objeto estruturado', () => {
    const logger = new AppLogger();
    logger.log(JSON.stringify({ event: 'provider_success', providerName: 'viacep' }), 'CepService');

    const written = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(written.message).toEqual({ event: 'provider_success', providerName: 'viacep' });
  });

  it('escreve erros em stderr', () => {
    const logger = new AppLogger();
    logger.error('algo quebrou', 'stacktrace-fake', 'CepService');

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse((stderrSpy.mock.calls[0][0] as string).trim());
    expect(written.level).toBe('error');
    expect(written.message).toEqual({ message: 'algo quebrou', trace: 'stacktrace-fake' });
  });
});
