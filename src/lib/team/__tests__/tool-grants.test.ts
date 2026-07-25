// 成员工具授权回归(#46)。
// 病史:缺省只开读研 + UI 把 false 显式写进人设,团队 SOP 干到"跑 python 写台账"必然失败,
// 成员还把"没授权"编成"环境不支持"。现在缺省全开,被收紧时必须明确告知。

jest.mock('@/lib/tools/lumos-mcp-server', () => ({ LUMOS_MCP_SERVER_NAME: 'lumos' }));

import {
  buildToolGrantNotice,
  DEFAULT_TOOL_PERMISSIONS,
  grantsToDisallowedTools,
  TEAM_IMAGE_TOOL,
} from '../tool-grants';

describe('DEFAULT_TOOL_PERMISSIONS', () => {
  it('缺省全开——团队跑本机自己的活,默认要能干完整工序', () => {
    expect(DEFAULT_TOOL_PERMISSIONS).toEqual({ read: true, write: true, exec: true });
  });
});

describe('grantsToDisallowedTools', () => {
  it('没配档位时不禁任何工具(走全开缺省)', () => {
    expect(grantsToDisallowedTools(undefined)).toEqual([]);
  });

  it('全开时不禁任何工具', () => {
    expect(grantsToDisallowedTools({ read: true, write: true, exec: true })).toEqual([]);
  });

  it('关掉 exec 只禁 Bash', () => {
    const out = grantsToDisallowedTools({ read: true, write: true, exec: false });
    expect(out).toEqual(['Bash']);
  });

  it('关掉 write 禁写文件与出图,不影响 Bash', () => {
    const out = grantsToDisallowedTools({ read: true, write: false, exec: true });
    expect(out).toEqual(['Write', 'Edit', TEAM_IMAGE_TOOL]);
    expect(out).not.toContain('Bash');
  });

  it('两个都关时全禁', () => {
    const out = grantsToDisallowedTools({ read: true, write: false, exec: false });
    expect(out).toEqual(['Bash', 'Write', 'Edit', TEAM_IMAGE_TOOL]);
  });
});

describe('buildToolGrantNotice', () => {
  it('权限全开时返回空串,不占 token', () => {
    expect(buildToolGrantNotice({ read: true, write: true, exec: true })).toBe('');
    expect(buildToolGrantNotice(undefined)).toBe('');
  });

  it('关掉 exec 时讲清缺什么、去哪开,并禁止推给"环境不支持"', () => {
    const notice = buildToolGrantNotice({ read: true, write: true, exec: false });
    expect(notice).toContain('执行命令');
    expect(notice).toContain('python');
    expect(notice).toContain('成员');
    // 这是 #46 的病根:成员把"没授权"说成"环境不支持"
    expect(notice).toContain('严禁说成「环境不支持');
    expect(notice).toContain('授权问题,不是环境问题');
  });

  it('关掉 write 时点明不能写文件和出图', () => {
    const notice = buildToolGrantNotice({ read: true, write: false, exec: true });
    expect(notice).toContain('产出');
    expect(notice).toContain('不能写文件');
    expect(notice).not.toContain('执行命令(Bash)');
  });

  it('禁止用占位内容冒充产出', () => {
    const notice = buildToolGrantNotice({ read: true, write: false, exec: false });
    expect(notice).toContain('严禁用占位内容');
  });
});
