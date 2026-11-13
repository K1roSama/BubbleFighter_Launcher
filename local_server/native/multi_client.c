/* Current 752 WinMain C50800 uses the named mutex at RVA EE1358.
   Change only the seven-byte mutex name in a child we just created suspended.
   The original EXE, existing processes, and machine settings are untouched. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

static BOOL read_exact(HANDLE process, LPCVOID address, void *out, SIZE_T size) {
    SIZE_T got=0;
    return ReadProcessMemory(process,address,out,size,&got) && got==size;
}

int wmain(int argc, wchar_t **argv) {
    wchar_t root[MAX_PATH],exe[MAX_PATH],command[2*MAX_PATH];
    STARTUPINFOW start={sizeof(start)};
    PROCESS_INFORMATION child={0};
    CONTEXT context={0};
    IMAGE_DOS_HEADER dos;
    IMAGE_NT_HEADERS32 nt;
    DWORD base=0,old=0,ignored=0,pid;
    SIZE_T wrote=0;
    char original[7],name[7],digits[]="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    int i,status=1;
    const wchar_t *ip=L"127.0.0.1", *port=L"7100";
    const wchar_t *client=L"BubbleFighterU.exe";
    if ((argc!=2 && argc!=4 && argc!=5) || !GetFullPathNameW(argv[1],MAX_PATH,root,NULL)) return 2;
    if (argc==5) {
        if (wcscmp(argv[4],L"BubbleFighterU.exe") && wcscmp(argv[4],L"BubbleFighter.exe")) return 2;
        client=argv[4];
    }
    if (argc>=4) {
        ip=argv[2];port=argv[3];
        if (!*ip || wcslen(ip)>15 || wcsspn(ip,L"0123456789.")!=wcslen(ip) ||
            !*port || wcslen(port)>5 || wcsspn(port,L"0123456789")!=wcslen(port) ||
            _wtoi(port)<1 || _wtoi(port)>65535) return 2;
    }
    if (swprintf_s(exe,MAX_PATH,L"%s\\%s",root,client)<0 ||
        swprintf_s(command,2*MAX_PATH,L"\"%s\" --ip=%s --port=%s --areaid=1_1 --groupid=1",exe,ip,port)<0) return 2;
    if (!CreateProcessW(exe,command,NULL,NULL,FALSE,CREATE_SUSPENDED,NULL,root,&start,&child)) {
        fprintf(stderr,"CreateProcess failed: %lu\n",GetLastError());return 1;
    }
    context.ContextFlags=CONTEXT_INTEGER;
    if (!GetThreadContext(child.hThread,&context) ||
        !read_exact(child.hProcess,(void *)(context.Ebx+8),&base,4) ||
        !read_exact(child.hProcess,(void *)base,&dos,sizeof(dos)) || dos.e_magic!=IMAGE_DOS_SIGNATURE ||
        dos.e_lfanew<=0 || dos.e_lfanew>4096 ||
        !read_exact(child.hProcess,(void *)(base+dos.e_lfanew),&nt,sizeof(nt)) ||
        nt.Signature!=IMAGE_NT_SIGNATURE || nt.FileHeader.Machine!=IMAGE_FILE_MACHINE_I386 ||
        nt.FileHeader.TimeDateStamp!=0x595ce881 || nt.OptionalHeader.SizeOfImage!=0x1783000 ||
        !read_exact(child.hProcess,(void *)(base+0xee1358),original,7) || memcmp(original,"Lambda",7)) {
        fprintf(stderr,"Current client image/mutex verification failed: %lu\n",GetLastError());goto done;
    }
    pid=child.dwProcessId;name[6]=0;
    for (i=5;i>=0;--i) { name[i]=digits[pid%36];pid/=36; }
    if (!VirtualProtectEx(child.hProcess,(void *)(base+0xee1358),7,PAGE_READWRITE,&old)) goto done;
    if (!WriteProcessMemory(child.hProcess,(void *)(base+0xee1358),name,7,&wrote) || wrote!=7) goto done;
    if (!VirtualProtectEx(child.hProcess,(void *)(base+0xee1358),7,old,&ignored)) goto done;
    if (ResumeThread(child.hThread)==(DWORD)-1) goto done;
    printf("Local multi-client started: PID %lu\n",child.dwProcessId);
    status=0;
done:
    if (status) {
        fprintf(stderr,"Multi-client launch failed: %lu; closing only the new suspended child.\n",GetLastError());
        TerminateProcess(child.hProcess,1);
        WaitForSingleObject(child.hProcess,5000);
    }
    CloseHandle(child.hThread);CloseHandle(child.hProcess);
    return status;
}
