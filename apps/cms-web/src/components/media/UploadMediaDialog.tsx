import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { api, formatBytes } from '../../lib/api';

interface UploadMediaDialogProps {
  open: boolean;
  onClose: () => void;
}

export function UploadMediaDialog({ open, onClose }: UploadMediaDialogProps) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const resetAndClose = () => {
    setFile(null);
    setTitle('');
    setUploadError(null);
    onClose();
  };

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadError('Please select an image or video file.');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const { asset, uploadUrl } = await api.requestUploadUrl({
        title: title.trim() || file.name,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error(`Storage upload failed (${putRes.status})`);
      }

      await api.completeUpload(asset.id);
      await queryClient.invalidateQueries({ queryKey: ['media'] });
      resetAndClose();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resetAndClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Media</DialogTitle>
          <DialogDescription>
            Upload video or image assets directly to RustFS S3 storage for FFmpeg verification.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleUpload} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="media-title">Title</Label>
            <Input
              id="media-title"
              type="text"
              placeholder="e.g. Lobby 4K Promo Loop"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>File (Video or Image)</Label>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border bg-background/60 p-6 text-center transition-colors hover:border-ring">
              <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
              <span className="text-xs font-medium">
                {file ? `${file.name} (${formatBytes(file.size)})` : 'Choose MP4, WebM, PNG, or JPG'}
              </span>
              <input
                type="file"
                accept="video/*,image/*"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0] ?? null;
                  setFile(selected);
                  if (selected && !title) {
                    setTitle(selected.name.replace(/\.[^.]+$/, ''));
                  }
                }}
              />
            </label>
          </div>

          {uploadError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
              {uploadError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={uploading || !file}>
              {uploading ? 'Uploading...' : 'Upload & Verify'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
