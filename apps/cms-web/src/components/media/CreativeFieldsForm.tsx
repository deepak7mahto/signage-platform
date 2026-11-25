import type { CreativeFieldDef } from '@signage/shared';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface CreativeFieldsFormProps {
  fields: CreativeFieldDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

export function CreativeFieldsForm({ fields, values, onChange }: CreativeFieldsFormProps) {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const val = values[field.key] ?? field.defaultValue ?? '';
        const inputId = `creative-field-${field.key}`;

        if (field.fieldType === 'select' && field.options) {
          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={inputId}>
                {field.label}
                {field.required ? ' *' : ''}
              </Label>
              <Select value={val || field.options[0]?.value || ''} onValueChange={(v) => onChange(field.key, v)}>
                <SelectTrigger id={inputId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (field.fieldType === 'textarea') {
          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={inputId}>
                {field.label}
                {field.required ? ' *' : ''}
              </Label>
              <textarea
                id={inputId}
                required={field.required}
                placeholder={field.placeholder}
                value={val}
                onChange={(e) => onChange(field.key, e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          );
        }

        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={inputId}>
              {field.label}
              {field.required ? ' *' : ''}
            </Label>
            <Input
              id={inputId}
              type={field.fieldType === 'url' ? 'url' : field.fieldType === 'number' ? 'number' : 'text'}
              required={field.required}
              placeholder={field.placeholder}
              value={val}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
